/*
 * This script file is for not-logged user
 */

if ( userLoggedIn === true ) {
	purgeLocalStorage(false);
	createLoginExpiredNotification();
} else {
	document.getElementById("login-btn").addEventListener('click', () => {createAccountLoginModal()});
	window.addEventListener("load", () => {
		if ( !userLoggedIn ){
			const html = `<p><strong>Write.JS</strong> is much better with account!</p><p class="row"><button class="btn small primary" onclick="createRegisterModal();closeAllNotifications();">Create your own right now!</button> or <button class="btn small" onclick="createAccountLoginModalWithNotificationClose()">Login to your existing account</button>`
			createNotification(html, "info", null, true);
		}
	});
}
function createAccountLoginModal(username=null){
	closeAllModals();
	const html = `
	<form class="stack" method="POST" action="/api/auth/login/submit">
		<label>Login<input type="text" name="username" id="login" placeholder="Username or E-mail address" required></label>
		<label>Password<input id="password" name="password" type="password" placeholder="******" required></label>
		<div class="row"><button class="btn primary" type="submit">Login</button></div>
	</form>
	<hr>
	<div class="row">
		<button class="btn" onclick="createRegisterModal()">Create account!</button>
		<button class="btn ghost" onclick="createForgottenPasswordModal()">I forgot password</button>
	</div>
	`
	createModal("Login - Write.JS", html)
	if ( username ){
		document.getElementById("login").value = username;
	}
}

function createRegisterModal(){
	closeAllModals();
	const html = `
	<div class="stack">
		<label>Login<input id="account-register-username" placeholder="Your unique username!" required></label>
		<label>Email<input id="account-register-email" type="email" placeholder="Your E-mail address" required></label>
		<label>Password<input id="account-register-password" type="password" placeholder="Secure password that is 6-32 characters long" required></label>
		<div class="row"><button class="btn primary" onclick="sendRegisterRequest()">Register</button></div>
	</div>
	<hr>
	<div class="row"><span class="muted">Already have an account?</span><button class="btn" onclick="createAccountLoginModal()">Login</button></div>
	`
	createModal("Register - Write.JS", html)
}

function createForgottenPasswordModal(){
	closeAllModals();
	const html = `
	<div class="stack">
		<label>Login<input id="account-forgot-login" placeholder="Your username or E-mail address"></label>
		<div class="row"><button class="btn primary" onclick="sendForgottenPasswordRequest()">Send an e-mail</button></div>
	</div>
	<hr>
	<div class="row"><button class="btn ghost" onclick="createAccountLoginModal()">Okay, I remember now</button></div>
	`
	createModal("Forgot your password? - Write.JS", html)
}


async function sendRegisterRequest(){
	try {
		const userEl = document.getElementById("account-register-username");
		const emaiEl = document.getElementById("account-register-email");
		const passEl = document.getElementById("account-register-password");
		const payload = {
			"username": userEl.value,
			"email": emaiEl.value,
			"password": passEl.value
		}
		let errors = ""
		for ( const [k,v] of Object.entries(payload)){ if (v){continue} errors = `${errors}\n- ${k} has to be filled in!` }
		if ( errors ) { createNotification(errors, "error", null); return }
		userEl.value = "";
		emaiEl.value = "";
		passEl.value = "";
		const resp = await fetch("/api/auth/register",
			{
				method: "POST",
				body: JSON.stringify(payload),
				headers: {"Content-Type": "application/json"}
			}
		)
		const respText = await resp.json();
		if ( resp.status == 201 || resp.status == 200 ){
			closeAllModals();
			const html = `<p>You can login as <strong>${payload.username}</strong>! <button class="btn small primary" onclick="createAccountLoginModal('${payload.username}');closeAllNotifications();">Login now!</button>`
			closeAllNotifications();
			createNotification(html, "info", null, true);
			return
		}
		createNotification(`There were some problems with register:\n ${JSON.stringify(respText, null, "\t")}`, "error", null);
		return
	} catch (err){
		informError("Cannot register user!", err, "error");
	}
}

async function sendForgottenPasswordRequest(){
	try {
		const val = document.getElementById("account-forgot-login").value;
		if ( !val ) { createNotification("You have to fill Login with username or E-mail address!", "error", null);return}
		const payload = {
			login: val
		}
		const resp = await fetch("/api/auth/forgot-password",
			{
				method: "POST",
				body: JSON.stringify(payload),
				headers: {"Content-Type": "application/json"}
			}
		);
		if ( resp.status === 200 ) {
			createNotification("Password reset mail has been sent.", "info", notificationTimeoutLong, true);
			return
		} else if ( resp.status ){
			createNotification("Cannot sent password reset mail, please check your login!.", "error", null, true);
			return
		}
		createNotification("Cannot sent password reset mail!\nPlease try again...", "error", notificationTimeoutLong, true);
	} catch ( err ) {
		informError("Cannot sent password reset mail!\nPlease try again...", "error");
	}


}

function createAccountLoginModalWithNotificationClose(){
	closeAllNotifications();
	createAccountLoginModal();
}
