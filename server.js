// Node.js  (usa axios, pg o tu ORM preferido, Bottleneck para rate-limiting)
// npm install axios pg bottleneck retry

const axios = require('axios');
const { Client } = require('pg'); // o tu ORM
const Bottleneck = require('bottleneck');
const retry = require('retry');

const API_VERSION = process.env.META_API_VERSION || 'v16.0';
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT_ID = process.env.AD_ACCOUNT_ID; // act_<num>
const DB_URL = process.env.DATABASE_URL;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '4', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '20', 10);

if (!ACCESS_TOKEN || !AD_ACCOUNT_ID || !DB_URL) {
  console.error('Faltan variables de entorno: META_ACCESS_TOKEN, AD_ACCOUNT_ID, DATABASE_URL');
  process.exit(1);
}

// Pool/Client DB (ejemplo con pg)
const db = new Client({ connectionString: DB_URL });
db.connect();

// Rate limiter para no superar límites de la API
const limiter = new Bottleneck({
  maxConcurrent: CONCURRENCY,
  minTime: 200 // intervalo mínimo entre requests (ajusta según tus límites)
});

async function requestWithRetry(method, url, params = {}, data = null) {
  return new Promise((resolve, reject) => {
    const operation = retry.operation({
      retries: 3,
      factor: 2,
      minTimeout: 1000,
      maxTimeout: 60000
    });
    operation.attempt(async (current) => {
      try {
        const config = { params: { access_token: ACCESS_TOKEN, ...params } };
        let res;
        if (method === 'get') res = await limiter.schedule(() => axios.get(url, config));
        else if (method === 'post') res = await limiter.schedule(() => axios.post(url, data, { params: { access_token: ACCESS_TOKEN, ...params } }));
        else if (method === 'delete') res = await limiter.schedule(() => axios.delete(url, config));
        else res = await limiter.schedule(() => axios({ method, url, data, params: { access_token: ACCESS_TOKEN, ...params } }));
        resolve(res.data);
      } catch (err) {
        const shouldRetry = err.response && [429, 500, 502, 503, 504].includes(err.response.status);
        if (shouldRetry && operation.retry(err)) {
          console.warn(`Reintentando ${method.toUpperCase()} ${url} (intento ${current})`);
          return;
        }
        reject(err);
      }
    });
  });
}

// 1) Obtener campañas locales pendientes de enviar masivo
async function getLocalPendingCampaigns(limit = BATCH_SIZE) {
  // Ajusta según tu esquema. Supuesto: tabla campaigns con columnas:
  // id, name, meta_campaign_id, approved_by_meta (bool), mass_sent (bool)
  const q = `
    SELECT id, name, meta_campaign_id
    FROM campaigns
    WHERE approved_by_meta = true
      AND mass_sent = false
      AND meta_campaign_id IS NOT NULL
    LIMIT $1
  `;
  const res = await db.query(q, [limit]);
  return res.rows;
}

// 2) Comprobar estado en Meta (campaign)
async function getCampaignMetaStatus(metaCampaignId) {
  const url = `https://graph.facebook.com/${API_VERSION}/${metaCampaignId}`;
  const params = { fields: 'id,effective_status,ad_review_feedback' };
  return requestWithRetry('get', url, params);
}

// 3) Listar adsets de la campaña
async function listAdSetsForCampaign(metaCampaignId) {
  const url = `https://graph.facebook.com/${API_VERSION}/${metaCampaignId}/adsets`;
  const params = { fields: 'id,effective_status' , limit: 100 };
  return requestWithRetry('get', url, params)
    .then(r => r.data || [])
    .catch(err => { console.warn('No adsets o error:', err.message); return []; });
}

// 4) Listar ads de un adset
async function listAdsForAdSet(adsetId) {
  const url = `https://graph.facebook.com/${API_VERSION}/${adsetId}/ads`;
  const params = { fields: 'id,effective_status' , limit: 100 };
  return requestWithRetry('get', url, params)
    .then(r => r.data || [])
    .catch(err => { console.warn('No ads o error:', err.message); return []; });
}

// 5) Activar un objeto (campaign/adset/ad)
async function activateObject(objectId) {
  const url = `https://graph.facebook.com/${API_VERSION}/${objectId}`;
  const params = { status: 'ACTIVE' };
  return requestWithRetry('post', url, params);
}

// 6) Marcar en BD resultado
async function markCampaignMassSent(localId, metaId, ok, info = null) {
  const q = `
    UPDATE campaigns
    SET mass_sent = $1, mass_sent_at = NOW(), last_meta_info = $2
    WHERE id = $3
  `;
  await db.query(q, [ok, info ? JSON.stringify(info) : null, localId]);
}

// Flujo para procesar una campaña local
async function processCampaign(localCampaign) {
  const { id: localId, name, meta_campaign_id: metaId } = localCampaign;
  try {
    const metaStatus = await getCampaignMetaStatus(metaId);
    const effStatus = metaStatus.effective_status;
    const review = metaStatus.ad_review_feedback || null;

    // Si Meta reporta rechazo explícito, guardamos feedback y no activamos.
    if (review && Object.keys(review).length) {
      await markCampaignMassSent(localId, metaId, false, { reason: 'rejected', review });
      console.log(`Campaña ${localId} rechazada en Meta:`, review);
      return { localId, metaId, ok: false, reason: 'rejected', review };
    }

    // Consideraciones: en distintas versiones effective_status puede ser array o string.
    const isApproved = Array.isArray(effStatus) ? effStatus.includes('ACTIVE') || effStatus.includes('APPROVED') : effStatus === 'ACTIVE' || effStatus === 'APPROVED';

    if (!isApproved) {
      // Si no está aprobada, no forzamos activación: guardamos estado y salimos.
      await markCampaignMassSent(localId, metaId, false, { reason: 'not_approved', effective_status: effStatus });
      console.log(`Campaña ${localId} no está aprobada en Meta (status=${effStatus}).`);
      return { localId, metaId, ok: false, reason: 'not_approved', effective_status: effStatus };
    }

    // Si está aprobada: activar campaign -> adsets -> ads (por si alguno quedó PAUSED)
    await activateObject(metaId);
    const adsets = await listAdSetsForCampaign(metaId);
    for (const adset of adsets) {
      await activateObject(adset.id);
      const ads = await listAdsForAdSet(adset.id);
      for (const ad of ads) {
        await activateObject(ad.id);
      }
    }

    // Marcar como enviado masivo
    await markCampaignMassSent(localId, metaId, true, { effective_status: effStatus });
    console.log(`Campaña local ${localId} (meta ${metaId}) activada correctamente.`);
    return { localId, metaId, ok: true };
  } catch (err) {
    console.error('Error procesando campaña', localId, err.response?.data || err.message);
    await markCampaignMassSent(localId, metaId, false, { reason: 'error', error: err.response?.data || err.message });
    return { localId, metaId, ok: false, reason: 'error', error: err.response?.data || err.message };
  }
}

// Orquestador por lotes
async function processBatch() {
  const candidates = await getLocalPendingCampaigns(BATCH_SIZE);
  if (!candidates.length) {
    console.log('No hay campañas pendientes.');
    return;
  }
  // Procesar en paralelo limitado por Bottleneck (internamente)
  const promises = candidates.map(c => processCampaign(c));
  const results = await Promise.all(promises);
  return results;
}

// Ejecución principal
(async () => {
  try {
    console.log('Iniciando job: enviar campañas aprobadas en Meta');
    const res = await processBatch();
    console.log('Resultado batch:', res);
  } catch (err) {
    console.error('Fallo en job principal', err);
  } finally {
    await db.end();
  }
})();
