setUserLoggedIn(true);
/*
 * This script file is authenticated user
 */


let remoteAutoSaveTimeout;
let notebook = null;
let remoteAutoSaveEnabled = true;
const remoteAutoSaveValue = 5000;
const remoteForceAutoSaveValue = 60000;
const refreshTokensTimeout = 360000
setTimeout( () => { loadNotebook() }, 1)

// Events
document.getElementById("save-btn").addEventListener("click", sendNotebook);
document.getElementById("load-notebook-btn").addEventListener("click", loadNotebookFromEvent);

//window.addEventListener("load", loadNotebook)
//window.addEventListener("load", refreshTokens)
window.addEventListener("load", (e) => {
	refreshTokens();
})

document.getElementById("account-btn").addEventListener('click', createAccountModal);
async function createAccountModal(){
	const html = `
	<div class="form-div">
		<h3>Logout</h3>
		<div class="double-button-div">
			<form method="GET" action="/api/auth/user/logout/">
				<button type="submit">Logout</button>
			</form>
			<form method="GET" action="/api/auth/user/logout/all">
				<button type="submit">Logout from All devices</button>
			</form>
			</div>
		<h3>Update Password</h3>
		<hr>
		<form id="form-update-password">
			<div class="form-field-label">
				<label for="old_password">Old Password</label>
				<input name="old_password" id="old_password" placeholder="your current password" required type="password">
			</div>
			<div class="form-field-label">
				<label for="new_password">New Password</label>
				<input name="new_password" id="new_password" placeholder="your new password" required type="password">
			</div>
			<br>
			<button type="submit">Update password</button>
			</form>
		<h3>Delete account</h3>
		<hr>
		<form id="form-delete-account">
			<div class="form-field-label">
				<label for="old_password">Password</label>
				<input name="old_password" id="password" placeholder="your current password" required type="password">
			</div>
			<div class="form-field-label">
				<label for="are_you_sure">Are you sure?</label>
				<div>
				<input name="are_you_sure" id="are_you_sure" placeholder="Are you sure?" required type="checkbox"><span>    I'm sure</span>
				</div>
			</div>
			<br>
			<button type="submit">Delete</button>
		</form>
		<h3>Who am I?</h3>
		<div id="user-info">
		<pre></pre>
		</div>
	</div>
	`
	createModal("Account", html)
	// set events
	// Who am i
	 try{
		const resp = await fetch("/api/auth/me", 
			{
				method: "GET",
				credentials: "include"
			});
		const respText = await resp.json();
		if (resp.ok){
			const txt = `${respText.username}\n${respText.email}`
			document.querySelector("#user-info pre").innerText = txt;
		} else {
			console.error(resp);
			createNotification("Cannot fetch info about you, sorry!", "error", notificationTimeoutLong)
		}
	 } catch (err){
			informError('Cannot fetch user data', err, 'error');
		}
	// udpate password
	document.querySelector("#form-update-password").addEventListener("submit", async (e) => {
		e.preventDefault();
		const oldEl = document.getElementById("old_password");
		const newEl = document.getElementById("new_password");
		try {
			const payload = {
				old_password: oldEl.value,
				new_password: newEl.value
			}
			// send request
			const resp = await fetch("/api/auth/user/password/update", {
				method: "POST",
				body: JSON.stringify(payload),
				headers: {"Content-Type": "application/json"},
				credentials: "include"
			})
			const respText = await resp.json();
			if ( resp.status === 200 ){
				closeAllModals();
				createNotification("Password changed succesfully!", "info")
				oldEl.classList.remove("error");
				newEl.classList.remove("error");
				return
			}
			createNotification(`Cannot change password, due to\n${JSON.stringify(respText, null, "\t")}`,  "error", notificationTimeoutLong)
			oldEl.classList.add("error");
			newEl.classList.add("error");
		} catch ( err ) {
			informError("Cannot change password!",err)
		}
	})
	// delete password
	document.querySelector("#form-delete-account").addEventListener("submit", async (e) => {
		e.preventDefault();
		if ( !showConfirm("Do you really want to delete your account and ALL your documents?")){ return }
		const oldEl = document.getElementById("password");
		const newEl = document.getElementById("are_you_sure");
		console.log(newEl)
		try {
			console.log(newEl)
			const payload = {
				old_password: oldEl.value,
				are_you_sure: newEl.value
			}
			// send request
			const resp = await fetch("/api/auth/delete", {
				method: "POST",
				body: JSON.stringify(payload),
				headers: {"Content-Type": "application/json"},
				credentials: "include"
			})
			if ( resp.status === 204 ){
				console.log(1)
				window.location = "?logout=4"
				return
			}
			createNotification(`Cannot delete user!`,  "error", notificationTimeoutLong)
			oldEl.classList.add("error");
			newEl.classList.add("error");
		} catch ( err ) {
			informError("Cannot change password!",err)
		}
	})
}

async function sendNotebook(){
	// first fetch notebook and open Merge Editor if version of remote is same or higher
	loadNotebook(true)
	// then send to the remote
	return await sendNotebookForce()

}
async function sendNotebookForce(){
	try {
		const payload = compressObject(JSON.stringify(getAllLocalStorageItems()));
		const resp = await fetch("/api/notebooks/notebook", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({"json_content": payload}),
			credentials: "include"
		})
		if ( resp.status != 201 ){
			throw new Error(resp);
		}
		createNotification("Notebook pushed to remote", "info", notificationTimeoutShort)

	} catch(err) {
		informError("Sync error! Cannot send notebook to the cloud!", err);
	}
}

async function fetchNotebook(){
	try {
		let resp;
			resp = await fetch("/api/notebooks/notebook", {
				method: "GET",
				credentials: "include"
			})
		if ( resp.status === 404 ){
		createNewNotebookModal();
		return 
		}
		console.warn("lol")
		if ( resp.status === 401 ) {
			window.location = "?logout=3";
			return null;
		} else if ( resp.status != 200 ){
			throw new Error(resp);
		}
		const respText = await resp.json()
		const json_content = respText.json_content
		//notebook = json_content
		return json_content

	} catch(err) {
		informError("cannot fetch notebook", err);
	}
}

async function loadNotebookFromEvent(e){
	await loadNotebook();
}
async function loadNotebook(excludeCurrentDocument=false){
	const encodedNotebook = await fetchNotebook();
	if ( encodedNotebook ){
		loadNotebookFromJson(encodedNotebook, excludeCurrentDocument);
		return
	}
}

function loadNotebookFromJson(json, excludeCurrentDocument=true){
	jsonObject = decompressObject(json);
	loadDataFromLocalStorageJson(jsonObject, excludeCurrentDocument)
	loadLastOpenedDocument()
}

function createChangePasswordModal(){
	// assign enter events
	try{
		document.getElementById("old-password").addEventListener("keypress", (e) => { if ( e.key === "Enter"){changePassword()}})
		document.getElementById("new-password").addEventListener("keypress", (e) => { if ( e.key === "Enter"){changePassword()}})
	} catch (err) {
		informError("Cannot open Change Password modal!", err, "error")

	}
}

async function fetchUserData(){
	try{
		const resp = await fetch("/api/auth/me", {
			"method": "GET",
			"credentials": "include"
		});
		const respData = await resp.json();
		if ( resp.status !== 200 ){
			createNotification(`Status of /api/auth/me was ${resp.status} instead of 200!`,"error", notificationTimeoutLong)
		}
		return respData
	} catch (err) {
		window.alert(err)
	}

}

async function startRefreshTokenProcess(){
	try {
		const resp = await fetch("/api/auth/token", {
			"method": "GET",
			"credentials": "include"
		});
		const respData = await resp.json();
		startRefreshTokenTimer(respData);
	} catch (err) {
		window.alert(err)
	}
}

async function refreshTokens(){
	try {
		const resp = await fetch("/api/auth/token/refresh", {
			"method": "POST",
			"credentials": "include"
		});
		if ( resp.redirected) {
			window.location.href = resp.url;  // Manually follow the redirect
			return;
		}
		const respData = await resp.json();
		if ( resp.status === 400 ){ // scenario for to fast refresh TODO - make it better

			return
		} else if ( resp.status != 200 ){
			createNotification(`Cannot read refresh tokens!`, "error", notificationTimeoutLong)
			throw new Error("Refresh Token response is not 200!");
		}
		startRefreshTokenTimer(respData);
	} catch (err) {
		window.alert(err)
		setTimeout( 
			() => { refreshTokens() },
			refreshTokensTimeout
			
		)
	}
}


function startRefreshTokenTimer(respObj){
		const accessTokenExpiresMs = respObj["access_token_expires"]* 1000
		const sleepTime = ( accessTokenExpiresMs - Date.now() ) - 60000
		setTimeout( 
			() => { refreshTokens() },
			sleepTime
		)
}


async function changePassword(){
	try {
		const oldPasswordElement = document.getElementById("old-password");
		const newPasswordElement = document.getElementById("new-password");
		const payload = {
			"old_password": oldPasswordElement.value,
			"new_password": newPasswordElement.value
		}
		if ( !payload.old_password || !payload.new_password ){
			oldPasswordElement.classList.add("field-error");
			newPasswordElement.classList.add("field-error");
			createNotification("Passwords have to be filled in!","error", null)
			return
		}
		oldPasswordElement.classList.remove("error");
		newPasswordElement.classList.remove("error");
		const resp = await fetch("/api/auth/user/password/update", {
			"method": "POST",
			"credentials": "include",
			"headers": {"Content-Type": "application/json"},
			"body": JSON.stringify(payload)
		});
		const respData = await resp.json();
		if ( resp.status != 200 ){
			createNotification(`${JSON.stringify(respData)}`,"error", notificationTimeoutLong)
			document.getElementById("user-info-container").innerText = JSON.stringify(respData, null, "\t")
			throw new Error("Cannot  change password!")
		}
		if ( resp.status === 200 ) {
			createNotification(`Password changed!`, 'success', notificationTimeoutLong)
			document.getElementById("user-info-container").innerText = JSON.stringify({"msg":"password changed"}, null, "\t")
		}
	} catch ( err ) {
		console.error(err)
		createNotification("Cannot send changePassword!", "error", null)
	}
}


function handleRemoteAutosave(){
	if ( !remoteAutoSaveEnabled ) { return }
	clearTimeout(remoteAutoSaveTimeout);
	remoteAutoSaveTimeout = setTimeout(perofrmRemoteAutosave, remoteAutoSaveValue);
}

function perofrmRemoteAutosave(){
	if ( !remoteAutoSaveEnabled ) { return }
	sendNotebookForce(); // TODO user sendNotebook, but doens't fetch existing document
}

function firstLoginOnDevice(){
	// fresh user scenario
	closeAllModals();
	loadNotebook();
	if ( !countDocuments ) { return }
	if ( localStorage.getItem(darkModeKey)){ setDarkMode(1);toggleDarkMode(false)}
	startRefreshTokenTimer({"access_token_expires": 63});
	createNotification("Welcome back!", "info")
	setTimeout(openDocumentFromLocalStorage, 100);
}

function createNewNotebookModal(){
	closeAllModals();
	const html = `
	<h3>Welcome to Write.JS!</h3>
	<hr>
	<span>Check contents of menu to see what functions can you use!</span>
	<hr>
	<div class="form-div">
	<button id="welcome-ok"><img src="${base64icon}"></img>Start your Write.JS journey right now!</button>
	</div>
	`
	createModal("Welcome", html);
	// events
	document.getElementById("welcome-ok").addEventListener("click",() => {closeAllModals()})
}
