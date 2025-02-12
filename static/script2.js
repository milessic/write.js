/*
 * This script file is for not-logged user
 */
document.getElementById("login-btn").addEventListener('click', createAccountLoginModal);
function createAccountLoginModal(){
	const html = `
	<div class="form-div">
		<form method="POST" action="/api/auth/login/submit">
			<div class="form-field-label">
				<label for="login">Login</label>
				<input type="text" name="username" id="login">
			</div>
			<div class="form-field-label">
				<label for="password">Password</label>
				<input id="password" name="password" type="password">
			</div>
			<button type="submit">Login</button>
		</form>
		<button onclick="createRegisterModal()">Create account!</button>
		<button onclick="createForgottenPasswordModal()">I forgot password</button>
	</div>
	`
	createModal("Login", html)
}

function createRegisterModal(){
	closeAllModals();
	const html = `
	<div class="form-div">
		<div class="form-field-label">
			<label for="account-register-username">Login</label>
			<input id="account-register-username">
		</div>
		<div class="form-field-label">
			<label for="account-register-email">Email</label>
			<input id="account-register-email" type="email">
		</div>
		<div class="form-field-label">
			<label for="account-register-password">Password</label>
			<input id="account-register-password" type="password">
		</div>
		<button onclick="sendRegisterRequest()">Register</button>
	</div>
	`
	createModal("Login", html)
}

function createForgottenPasswordModal(){
	closeAllModals();
	const html = `
	<div class="form-div">
		<div class="form-field-label">
			<label for="account-forgot-login">Login</label>
			<input id="account-forgot-login">
		</div>
		<button onclick="sendForgottenPasswordRequest()">Send en e-mail</button>
	</div>
	`
	createModal("Login", html)
}
