/*
 * API access shared by the web page and the desktop/mobile app (Tauri).
 * On the web the page is served by the API server: paths stay relative and auth rides on httponly cookies.
 * In the app the page is bundled (scripts/build_app.py writes static/app-config.js), so requests go to
 * the configured server and the tokens are kept in localStorage and sent as a Bearer header.
 */
const appConfig = window.WRITEJS_APP || null;
const isNativeApp = appConfig !== null;
const accessTokenKey = "__accessToken__";
const refreshTokenKey = "__refreshToken__";
const tokenKeys = [accessTokenKey, refreshTokenKey];

function apiFetch(path, options = {}){
	if ( !isNativeApp ) { return fetch(path, options) }
	const headers = new Headers(options.headers || {});
	// the refresh endpoint expects the refresh token, everything else the access token
	const token = localStorage.getItem(path.startsWith("/api/auth/token/refresh") ? refreshTokenKey : accessTokenKey);
	if ( token && !headers.has("Authorization") ) { headers.set("Authorization", `Bearer ${token}`) }
	return fetch(appConfig.apiBase + path, {...options, headers, credentials: "omit"});
}

function rememberTokens(data){
	if ( !isNativeApp ) { return }
	if ( data?.access_token ) { localStorage.setItem(accessTokenKey, data.access_token) }
	if ( data?.refresh_token ) { localStorage.setItem(refreshTokenKey, data.refresh_token) }
}

function forgetTokens(){
	for ( const key of tokenKeys ) { localStorage.removeItem(key) }
}

function hasAppSession(){
	return isNativeApp && localStorage.getItem(refreshTokenKey) !== null;
}

async function appLogin(form){
	// the web login is a form POST answered with cookies and a redirect; the app asks for the tokens instead
	try {
		const resp = await apiFetch("/api/auth/token", {
			method: "POST",
			headers: {"Content-Type": "application/x-www-form-urlencoded"},
			body: new URLSearchParams(new FormData(form))
		});
		const respData = await resp.json();
		if ( !resp.ok ){
			createNotification(`Cannot login!\n${respData?.detail ?? resp.status}`, "error", notificationTimeoutLong);
			return
		}
		rememberTokens(respData);
		window.location.href = "?msg=loginsuccess";
	} catch (err) {
		informError("Cannot login!", err);
	}
}

async function appLogout(fromAllDevices=false){
	try {
		await apiFetch(fromAllDevices ? "/api/auth/user/logout/all" : "/api/auth/user/logout");
	} catch (err) {
		console.warn("Cannot invalidate the session on the server", err);
	}
	// app-boot.js drops the tokens for any ?logout=, the web flow takes it from there
	window.location.href = "?logout=1";
}
