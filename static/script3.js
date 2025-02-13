/*
 * This script file is authenticated user
 */
let notebook = null
setTimeout( () => { fetchNotebook() }, 1)

document.getElementById("save-btn").addEventListener("click", sendNotebook);
document.getElementById("load-notebook-btn").addEventListener("click", loadNotebook);

document.getElementById("account-btn").addEventListener('click', createAccountModal);
function createAccountModal(){
	const html = `
	<div class="form-div">
		<form method="GET" action="/api/auth/user/logout/">
			<button type="submit">Logout</button>
		</form>
		<form method="GET" action="/api/auth/user/logout/all">
			<button type="submit">Logout from All devices</button>
		</form>
	</div>
	`
	createModal("Login", html)
}

async function sendNotebook(){
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

	} catch(err) {
		informError("Sync error! Cannot send notebook to the cloud!", err);
	}
}

async function fetchNotebook(){
	try {
		const resp = await fetch("/api/notebooks/notebook", {
			method: "GET",
			credentials: "include"
		})
		if ( resp.status == 404 ){
			createNewNotebookModal();
			return null
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

async function loadNotebook(){
	const encodedNotebook = await fetchNotebook();
	const jsonObject = decompressObject(encodedNotebook)
	loadDataFromLocalStorageJson(jsonObject)
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
			addToNotificationDiv(`Status of /api/auth/me was ${resp.status} instead of 200!`,"error")
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
		if ( resp.status != 200 ){
			addToNotificationDiv(`Cannot read refresh tokens!`, "error")
			throw new Error("Refresh Token response is not 200!");
		}
		startRefreshTokenTimer(respData);
	} catch (err) {
		window.alert(err)
		setTimeout( 
			() => { refreshTokens() },
			30000
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
			addToNotificationDiv("Passwords have to be filled in!","error")
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
			addToNotificationDiv(`${JSON.stringify(respData)}`,"error")
			document.getElementById("user-info-container").innerText = JSON.stringify(respData, null, "\t")
			throw new Error("Cannot  change password!")
		}
		if ( resp.status === 200 ) {
			addToNotificationDiv(`Password changed!`, 'success')
			document.getElementById("user-info-container").innerText = JSON.stringify({"msg":"password changed"}, null, "\t")
		}
	} catch ( err ) {
		console.error(err)
		addToNotificationDiv("Cannot send changePassword!", "error")
	}
}
