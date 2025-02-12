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
