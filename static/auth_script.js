try{
document.getElementById("old-password").addEventListener("keypress", handlePasswordKeyPress)
document.getElementById("new-password").addEventListener("keypress", handlePasswordKeyPress)
} catch (err) {
}

function handleQueries(){
	const params = new URLSearchParams(window.location.search);
	console.log(params)
	if (params.get("status") === "success"){
		const html = "<strong>Congratulations!</strong> "
			+ "You can login as "
			+ `<strong>${params.get('username')}</strong>`
		addToNotificationDiv(html, "success");
	} else if ( params.get("status") === "unknownfailure" ){
		const html = "<strong>Unfortunately there were some unexpeted error!</strong>"
			+ "<br>"
			+ "";
		addToNotificationDiv(html, "error")
	} else if ( params.get("logout") == 1 ) {
		addToNotificationDiv(`You have been logged out.`, 'success');
	} else if ( newPass = params?.get("newpassword") ) {
		addToNotificationDiv(`Your new password is <strong>${newPass}</strong>`, "success")
		addToNotificationDiv(`<b>Change it immediately after login!</b>`, "warning")
	} else if ( params.get("passwordresetsent") ) {
		addToNotificationDiv(`Password reset mail has been sent!`, 'success');
	} else if ( params.get("status") === "failure" ){
		for ( let key of params.keys()){
			if ( key === "status" ) { continue }
			switch ( key ) {
				case "password":
					addToNotificationDiv(`<p><strong>Password</strong> has to be:</p>
						<ul>
						<li>at least 7 characters long</li>
						<li>at max 31 characters longlong</li>
						</ul>`, "error")
					break;
				case "email":
					addToNotificationDiv(`<p>This <strong>Email</strong> is already taken</p>`, "error")
					break
				case "username":
					addToNotificationDiv(`<p>This <strong>Username</strong> is already taken</p>`, "error")
					break
				case "message":
					if ( params.get(key) === "invalidpassword" ){
						addToNotificationDiv(`Invalid Password for user <strong>${params.get('login')}</strong>`, "error")
						return
					} else if ( params.get(key) === 'forgotpassworderror' ){
						addToNotificationDiv(`Cannot perform password reset!<br>If you wanted to reset your password, do it again`, "error")
						return
					}
				default:
					addToNotificationDiv(`<p>There was some other issue, sorry!</p>`, 'error')
					break;
			}
		}

	}
}




async function setUserData(){
	const data = await fetchUserData();
	document.getElementById("user-info-container").innerText = JSON.stringify(data, null, "\t")
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

function addToNotificationDiv(innerHTML, notificationStatus,){
	// set notification div
	const notification_div = document.querySelector("#notification-div")
	const elId = `notification-${document.querySelectorAll("#notification-div div").length}`
	const htmlToPut = `<div id="${elId}" class="${notificationStatus}"><div class="notification-content">${innerHTML}</div><div class="submit-button notification-close" onclick="closeNotification('${elId}')">X</div></div>`
	if (notification_div.innerHTML.includes(htmlToPut)){return}
	notification_div.innerHTML += htmlToPut;
}

function closeNotification(elId){
	document.getElementById(elId).remove();
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
function handlePasswordKeyPress(e){
	if ( e.key === "Enter" ){
		changePassword();
	}
}
