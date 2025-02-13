/*
 * This script file is for not-logged user
 */

document.getElementById("login-btn").addEventListener('click', () => {createAccountLoginModal()});
window.addEventListener("load", () => {
	const html = `<p><strong>Write.JS</strong> is much better with account!</p><br><button onclick="createRegisterModal();closeAllNotifications();">Create your own right now!</button>`
	createNotification(html, "info", null, true);
})
function createAccountLoginModal(username=null){
	closeAllModals();
	const html = `
	<div class="form-div">
		<form method="POST" action="/api/auth/login/submit">
			<div class="form-field-label">
				<label for="login">Login</label>
				<input type="text" name="username" id="login" placeholder="Username or E-mail address">
			</div>
			<div class="form-field-label">
				<label for="password">Password</label>
				<input id="password" name="password" type="password" placeholder="******">
			</div>
			<button type="submit">Login</button>
		</form>
		<hr>
		<button onclick="createRegisterModal()">Create account!</button>
		<button onclick="createForgottenPasswordModal()">I forgot password</button>
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
	<div class="form-div">
		<div class="form-field-label">
			<label for="account-register-username">Login</label>
			<input id="account-register-username" placeholder="Your unique username!">
		</div>
		<div class="form-field-label">
			<label for="account-register-email">Email</label>
			<input id="account-register-email" type="email" placeholder="Your E-mail address">
		</div>
		<div class="form-field-label">
			<label for="account-register-password">Password</label>
			<input id="account-register-password" type="password" placeholder="Secure password that is 6-32 characters long">
		</div>
		<button onclick="sendRegisterRequest()">Register</button>
		<hr>
		<span>Already have an account? <button onclick="createAccountLoginModal()">Login</button></span>
	</div>
	`
	createModal("Register - Write.JS", html)
}

function createForgottenPasswordModal(){
	closeAllModals();
	const html = `
	<div class="form-div">
		<div class="form-field-label">
			<label for="account-forgot-login">Login</label>
			<input id="account-forgot-login" placeholder="Your username or E-mail address">
		</div>
		<button onclick="sendForgottenPasswordRequest()">Send an e-mail</button>
		<hr>
		<button onclick="createAccountLoginModal()">Okay, I remember now</button>
	</div>
	`
	createModal("Forgot your password? - Write.JS", html)
}

async function handleForgotPassword(){
	try {
		const loginElement = document.getElementById("login");
		const payload = {
			"login": loginElement.value
		}
		if ( !payload.login ) {
			loginElement.classList.add("field-error");
			addToNotificationDiv("Username or E-mail has to be filled in!","error")
			return
		}
		const resp = await fetch("/api/auth/forgot-password", {
			"method": "POST",
			"credentials": "include",
			"headers": {"Content-Type": "application/json"},
			"body": JSON.stringify(payload)
		});
		const respData = await resp.json();
		if ( resp.status != 200 ){
			addToNotificationDiv(`${JSON.stringify(respData)}`,"error")
			document.getElementById("user-info-container").innerText = JSON.stringify(respData, null, "\t")
			throw new Error("Cannot  change password!")
		}
		if ( resp.status === 200 ) {
			addToNotificationDiv(`Password reset mail has been sent!`, 'success')
			loginElement.value = "";
			loginElement.classList.remove("field-error");
		}
		if ( resp.redirected) {
			window.location.href = resp.url;  // Manually follow the redirect
			return;
		} else {
			window.location.href = "/?passwordresetsent=1"
		}
	} catch ( err ) {
		console.error(err)
		addToNotificationDiv("Cannot send changePassword!", "error")
	}
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
			const html = `<p>You can login as <strong>${payload.username}</strong>!</p><br><button onclick="createAccountLoginModal('${payload.username}');closeAllNotifications();">Login now!</button>`
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
