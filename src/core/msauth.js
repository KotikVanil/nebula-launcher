// Microsoft -> Xbox Live -> XSTS -> Minecraft services authentication chain.
const net = require('./net');

// Public client id of the official launcher (Live flow). Users can set their own Azure id in settings.
const LIVE_CLIENT_ID = '00000000402b5328';
const LIVE_REDIRECT = 'https://login.live.com/oauth20_desktop.srf';
const LIVE_SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';
const AZURE_REDIRECT = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const AZURE_SCOPE = 'XboxLive.signin offline_access';

function flow(clientId) {
  const id = clientId || LIVE_CLIENT_ID;
  if (id === LIVE_CLIENT_ID) {
    return {
      clientId: id, live: true, redirect: LIVE_REDIRECT, scope: LIVE_SCOPE,
      authorize: 'https://login.live.com/oauth20_authorize.srf', token: 'https://login.live.com/oauth20_token.srf',
    };
  }
  return {
    clientId: id, live: false, redirect: AZURE_REDIRECT, scope: AZURE_SCOPE,
    authorize: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  };
}

function authUrl(clientId) {
  const f = flow(clientId);
  const q = new URLSearchParams({ client_id: f.clientId, response_type: 'code', redirect_uri: f.redirect, scope: f.scope, prompt: 'select_account' });
  return { url: `${f.authorize}?${q}`, redirect: f.redirect };
}

async function oauthToken(params, clientId) {
  const f = flow(clientId);
  const body = new URLSearchParams({ client_id: f.clientId, redirect_uri: f.redirect, scope: f.scope, ...params });
  const res = await net.request(f.token, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('Microsoft: ' + (data.error_description || data.error || res.status));
  return data;
}

const XERR = {
  2148916233: 'У этого аккаунта Microsoft нет профиля Xbox. Зайдите на xbox.com и создайте его.',
  2148916235: 'Xbox Live недоступен в вашей стране.',
  2148916236: 'Нужна проверка возраста на xbox.com.',
  2148916237: 'Нужна проверка возраста на xbox.com.',
  2148916238: 'Детский аккаунт: взрослый должен добавить его в семейную группу Microsoft.',
};

async function postJSON(url, body, headers = {}) {
  const res = await net.request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers } });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) {
    if (data.XErr && XERR[data.XErr]) throw new Error(XERR[data.XErr]);
    const err = new Error(`${url} → HTTP ${res.status} ${data.errorMessage || data.error || text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function minecraftFromMs(msAccessToken, live) {
  const xbl = await postJSON('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: live ? msAccessToken : 'd=' + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  const uhs = xbl.DisplayClaims.xui[0].uhs;
  const xsts = await postJSON('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
  });
  let mc;
  try {
    mc = await postJSON('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
  } catch (e) {
    if (e.status === 403) throw new Error('Minecraft отклонил Client ID (403). Используйте встроенный ID или одобренный Mojang Azure ID в настройках.');
    throw e;
  }
  const xuidClaims = xsts.DisplayClaims && xsts.DisplayClaims.xui && xsts.DisplayClaims.xui[0];
  return { accessToken: mc.access_token, expiresAt: Date.now() + (mc.expires_in - 60) * 1000, xuid: (xuidClaims && xuidClaims.xid) || '' };
}

async function profile(mcToken) {
  const res = await net.request('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + mcToken } });
  if (res.status === 404) throw new Error('На этом аккаунте Microsoft нет купленной Minecraft: Java Edition.');
  if (!res.ok) throw new Error('Не удалось получить профиль Minecraft: HTTP ' + res.status);
  return res.json();
}

// Full login with an authorization code
async function loginWithCode(code, clientId) {
  const f = flow(clientId);
  const tok = await oauthToken({ code, grant_type: 'authorization_code' }, clientId);
  const mc = await minecraftFromMs(tok.access_token, f.live);
  const prof = await profile(mc.accessToken);
  return { refreshToken: tok.refresh_token, clientId: f.clientId, ...mc, profile: prof };
}

async function refresh(refreshToken, clientId) {
  const f = flow(clientId);
  const tok = await oauthToken({ refresh_token: refreshToken, grant_type: 'refresh_token' }, clientId);
  const mc = await minecraftFromMs(tok.access_token, f.live);
  const prof = await profile(mc.accessToken);
  return { refreshToken: tok.refresh_token || refreshToken, clientId: f.clientId, ...mc, profile: prof };
}

module.exports = { LIVE_CLIENT_ID, authUrl, loginWithCode, refresh, profile, flow };
