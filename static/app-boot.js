/*
 * App only (Tauri): the web server picks script2.js / script3.js and the menu items from the auth cookie,
 * the bundled page decides here from the stored tokens instead.
 */
(() => {
	// every ?logout= (logout, expired session, deleted account) ends the app session
	if ( new URLSearchParams(window.location.search).has("logout") ) { forgetTokens() }
	const loggedIn = hasAppSession();
	const unused = loggedIn ? ["login-btn"] : ["account-btn", "load-notebook-btn"];
	for ( const id of unused ) { document.getElementById(id)?.remove() }

	const script = document.createElement("script");
	script.src = loggedIn ? "static/script3.js" : "static/script2.js";
	script.async = false;
	document.body.appendChild(script);
})();
