/*
 * Write.JS app on Android / iOS (server.py adds it to the page): the native web views don't download
 * blob links (Export, Export as Markdown, notebook backup), so their files are sent to the app, which saves
 * them in its documents folder (Files > On My iPhone > Write.JS, Android/data/.../files/Documents).
 */
(() => {
	const click = HTMLAnchorElement.prototype.click;
	HTMLAnchorElement.prototype.click = function(){
		if ( !this.hasAttribute("download") || !/^(blob|data):/.test(this.href) ) { return click.call(this) }
		const name = this.getAttribute("download") || "download";
		fetch(this.href)
			.then((resp) => resp.blob())
			.then((blob) => fetch(`/__writejs_app__/download?name=${encodeURIComponent(name)}`, {method: "POST", body: blob}))
			.then((resp) => { if ( !resp.ok ) { throw new Error(`HTTP ${resp.status}`) } })
			.catch((err) => typeof createNotification === "function"
				? createNotification(`'${name}' could not be saved: ${err}`, "error")
				: console.error(err));
	};
})();

// the app's own settings (the Write.JS server), at the end of the menu
document.addEventListener("DOMContentLoaded", () => {
	const menu = document.getElementById("menu");
	if ( !menu ) { return }
	const item = document.createElement("a");
	item.setAttribute("role", "menuitem");
	item.href = "/__writejs_app__/settings";
	item.textContent = "App settings";
	menu.appendChild(item);
});
