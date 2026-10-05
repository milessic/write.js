/*
 * This script file is for not-logged user
 */

if ( userLoggedIn === true ) {
	// on "load" so the consent handling there doesn't close the modal
	window.addEventListener("load", handleSessionExpired);
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

function handleSessionExpired(){
	"session ended without logout (expired, or 401 while syncing): the user decides what happens to the documents on this device"
	const documentCount = getDocumentNamesFromLocalStorage()?.length ?? 0;
	if ( !documentCount ){
		purgeLocalStorage(false);
		setUserLoggedIn(false);
		createLoginExpiredNotification();
		return
	}
	// edits made offline never reached the cloud, deleting them loses them for good
	const unsynced = localStorage.getItem(syncPendingKey)
		? `<p class="danger"><strong>Some changes were made offline and were never uploaded to the cloud.</strong> If you delete them now, they are lost.</p>`
		: "";
	createModal("Session expired", `
	<p>Your session has expired. What should happen with the ${documentCount} document(s) stored on this device?</p>
	${unsynced}
	<p class="muted small">Kept documents stay in this browser and are synced again after you log in. Delete them on a shared computer.</p>
	<div class="row">
		<button class="btn primary" id="session-expired-keep">Keep them on this device</button>
		<button class="btn danger" id="session-expired-delete">Delete them from this device</button>
	</div>`);
	document.getElementById("session-expired-keep").addEventListener("click", () => {
		setUserLoggedIn(false);
		closeAllModals();
		createLoginExpiredNotification();
	});
	document.getElementById("session-expired-delete").addEventListener("click", () => {
		if ( unsynced && !showConfirm("Delete documents with changes that were never uploaded?") ) { return }
		// documents are already open in tabs by now, close them so autosave can't write them back
		for ( const name of getDocumentNamesFromLocalStorage() ) { closeTabsOfDocument(name) }
		const tempUserConsent = userConsent;
		purgeLocalStorage(false);
		setUserConsent(tempUserConsent, false);
		setUserLoggedIn(false);
		closeAllModals();
		createLoginExpiredNotification();
	});
}
