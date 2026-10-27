/*
 * The functions a document's scripts can call (scripting.js). Each script gets its own set, bound to the editor of
 * the document it is in: they only ever find what is in that document.
 * Script help lists every function below that has a /** comment right above it, its name, parameters and that
 * comment, read from this file as it is: documenting a new function here is all it takes to show it there.
 */
const scriptApiUrl = document.currentScript?.src || "static/scriptapi.js";

function scriptApi(editor){
	const headings = (level) => [...editor.children].filter((el) => /^H[1-4]$/.test(el.nodeName) && (!level || el.nodeName === `H${level}`));

	/**
	 * Finds a heading of the document and the lines of its section.
	 * selector: the heading's text (a string, matched without the spaces around it) or its number (1 is the first
	 * heading), anything else throws. level: only headings of that level (1-4) are looked at, null for all of them.
	 * Returns {hText: "the heading's text", children: [the elements after it until the next heading of the same or a
	 * higher level], element: the heading}, or null when there is no such heading.
	 */
	function locateHeading(selector, level=null){
		if ( level !== null && ![1, 2, 3, 4].includes(level) ) { throw new TypeError(`locateHeading: level has to be 1-4 or null, not ${level}`) }
		const all = headings(level);
		let heading;
		if ( typeof selector === "string" ) {
			heading = all.find((el) => el.textContent.trim() === selector.trim());
		} else if ( typeof selector === "number" && Number.isInteger(selector) && selector > 0 ) {
			heading = all[selector - 1];
		} else {
			throw new TypeError(`locateHeading: the selector has to be the heading's text or its number (1, 2, ...), not ${typeof selector === "number" ? selector : typeof selector}`);
		}
		if ( !heading ) { return null }
		const own = Number(heading.nodeName[1]);
		const children = [];
		for ( let el = heading.nextElementSibling; el; el = el.nextElementSibling ) {
			if ( /^H[1-4]$/.test(el.nodeName) && Number(el.nodeName[1]) <= own ) { break }
			children.push(el);
		}
		return { hText: heading.textContent.trim(), children, element: heading };
	}

	/**
	 * Finds the element with the given id, assigned with a right click on a line's "+" (add comment) button.
	 * Returns the element, or null when no element of the document has that id.
	 */
	function locateById(id){
		return editor.querySelector(`[${elementIdAttribute}="${CSS.escape(String(id))}"]`);
	}

	/**
	 * Lists the items of a list: of the list given (its element, or its id or the id of one of its items), or of every
	 * list in the document without one. Nested items are listed too, in the order they are in the document.
	 * textOnly: true (default) returns only the items' texts, ["first item", ...]; false returns [{index: 0,
	 * text: "the item's text", checked: null for a bullet or a number, true or false for a checkbox, element: the item}, ...].
	 */
	function getListElements(list=null, textOnly=true){
		let root = editor;
		if ( list !== null ) {
			root = typeof list === "string" ? locateById(list) : list;
			if ( !(root instanceof Element) || !editor.contains(root) ) { throw new Error(`getListElements: no list "${list}" in this document`) }
			root = root.closest("ul, ol") || root;
			if ( !/^(UL|OL)$/.test(root.nodeName) ) { throw new Error(`getListElements: "${list}" is not a list`) }
		}
		const items = [...root.querySelectorAll("li")];
		if ( textOnly ) { return items.map((li) => li.textContent.trim()) }
		return items.map((li, index) => ({
			index,
			text: li.textContent.trim(),
			checked: li.hasAttribute("data-checked") ? li.dataset.checked === "true" : null,
			element: li,
		}));
	}

	/**
	 * Checks checkboxes: target is a checklist item (its element, its id, or an item of getListElements(list, false)),
	 * or a list (its element or its id), whose checkboxes, nested ones too, are all checked. A parent item whose items
	 * are all checked gets checked too, as by a click (Settings).
	 * Throws for an item that isn't a checkbox, or a list without any. Returns how many checkboxes changed.
	 */
	function checkCheckbox(target){
		return setCheckboxes(target, true, "checkCheckbox");
	}

	/**
	 * Unchecks checkboxes: target is a checklist item (its element, its id, or an item of getListElements(list, false)),
	 * or a list (its element or its id), whose checkboxes, nested ones too, are all unchecked. A parent item gets
	 * unchecked too, as by a click (Settings).
	 * Throws for an item that isn't a checkbox, or a list without any. Returns how many checkboxes changed.
	 */
	function uncheckCheckbox(target){
		return setCheckboxes(target, false, "uncheckCheckbox");
	}

	const setCheckboxes = (target, checked, caller) => {
		let el = typeof target === "string" ? locateById(target) : target?.element ?? target;
		if ( !(el instanceof Element) || !editor.contains(el) ) { throw new Error(`${caller}: no item or list ${typeof target === "string" ? `"${target}" ` : ""}in this document`) }
		let items;
		if ( el.nodeName === "LI" ) {
			if ( !isTaskItem(el) ) { throw new Error(`${caller}: "${el.textContent.trim()}" is not a checkbox`) }
			items = [el];
		} else if ( /^(UL|OL)$/.test(el.nodeName) ) {
			items = [...el.querySelectorAll("li")].filter(isTaskItem);
			if ( !items.length ) { throw new Error(`${caller}: the list has no checkboxes`) }
		} else {
			throw new Error(`${caller}: a list item or a list is needed, not <${el.nodeName.toLowerCase()}>`);
		}
		const changing = items.filter((li) => isChecked(li) !== checked);
		if ( changing.length ) { setTaskItemsChecked(changing, checked) } // checklist.js
		return changing.length;
	};

	/**
	 * Lists the checkboxes of the document as a tree, in the order they are in it.
	 * checked: false (default) lists the unchecked ones, true the checked ones, null all of them.
	 * Returns [{name: "the item's own text", level: 0 for an item of a list that isn't nested, 1 for one nested in an
	 * item, ..., checked: true or false, children: [the checkboxes listed nested in it, the same], element: the item}, ...];
	 * a listed checkbox under one that isn't listed is in the children of the closest listed one above it, or at the top.
	 * An item can be given to checkCheckbox / uncheckCheckbox.
	 */
	function getAllCheckboxes(checked=false){
		if ( checked !== null && typeof checked !== "boolean" ) { throw new TypeError(`getAllCheckboxes: checked has to be true, false or null, not ${typeof checked}`) }
		const listed = new Map(); // item -> its entry
		const top = [];
		for ( const li of editor.querySelectorAll("li") ) {
			if ( !isTaskItem(li) || (checked !== null && isChecked(li) !== checked) ) { continue } // checklist.js
			let level = 0;
			let parent = null;
			for ( let item = parentItem(li); item; item = parentItem(item) ) {
				level++;
				parent ??= listed.get(item);
			}
			const own = li.cloneNode(true);
			own.querySelectorAll("ul, ol").forEach((list) => list.remove());
			const entry = { name: own.textContent.trim(), level, checked: isChecked(li), children: [], element: li };
			listed.set(li, entry);
			(parent ? parent.children : top).push(entry);
		}
		return top;
	}

	/**
	 * The document's title, its name (as in the name field, also before it is saved).
	 */
	function getDocTitle(){
		// a cron job's document isn't shown (cron.js), its editor has its name
		const tab = tabById(paneOfEditor(editor)?.tabId);
		return tab ? tabLabelName(tab) : editor.dataset.docName || "";
	}

	/**
	 * Renames the document, like typing its title or its name does: the rename is saved with the document.
	 * title: the new name, a string (line breaks become spaces); an empty one, or the name of another document, throws.
	 * Returns the new name.
	 */
	function setDocTitle(title){
		const pane = paneOfEditor(editor);
		const tab = tabById(pane?.tabId);
		if ( !tab ) { throw new Error("setDocTitle: the document isn't opened") }
		if ( typeof title !== "string" ) { throw new TypeError(`setDocTitle: the title has to be a string, not ${title === null ? "null" : typeof title}`) }
		const name = title.replace(/\s*[\r\n]+\s*/g, " ").trim();
		if ( !name ) { throw new Error("setDocTitle: the title is empty") }
		if ( name !== tab.savedName && documentExists(name) ) { throw new Error(`setDocTitle: there is another document named "${name}"`) }
		if ( name === getDocTitle() ) { return name }
		focusPane(pane);
		documentNameObject.value = name;
		documentNameObject.dispatchEvent(new Event("input"));
		updateTitle();
		return name;
	}

	/**
	 * Picks a random item of an array (e.g. getRandomFromArray(getListElements()) for a random item's text).
	 * Returns the item, or null for an empty array; anything but an array throws.
	 */
	function getRandomFromArray(array){
		if ( !Array.isArray(array) ) { throw new TypeError(`getRandomFromArray: an array is needed, not ${array === null ? "null" : typeof array}`) }
		if ( !array.length ) { return null }
		const random = new Uint32Array(1);
		crypto.getRandomValues(random);
		return array[random[0] % array.length];
	}

	/**
	 * Shows a notification headed "Script execution". text is shown as plain text.
	 * type: "info" (default), "warning" or "error". timeout: milliseconds until it closes, 0 keeps it open.
	 * timestamp: true adds the time it is shown to the heading, "HH:MM:SS dd-mm-YYYY" (e.g. for a cron job's script).
	 */
	function createNotification(text, type="info", timeout=notificationTimeout, timestamp=false){
		return scriptNotification(String(text), type, timeout, null, Boolean(timestamp));
	}

	/**
	 * Duplicates a document of the notebook, like its "Duplicate" menu item: the copy is "name (copy)", in the same folder.
	 * documentQuery: {directory, index, doc}, what is left out is null.
	 * directory: the folder, its path ("Work/Daily", a folder's path is its id) or its name ("Daily"); "" for the
	 * documents outside of folders, null for all documents.
	 * doc: the document's name or id (Copy ID in its menu), null for any document of the directory.
	 * index: which of the matching documents, sorted by name: 0 the first, 1 the second, ..., -1 the last, -2 the
	 * second last; null when only one document may match.
	 * Throws when no document matches, or several do (without an index). Returns the copy's name.
	 */
	function duplicateDocument(documentQuery){
		const name = queryDocument(documentQuery, "duplicateDocument");
		const [copy] = duplicateDocuments([name]) || [];
		if ( !copy ) { throw new Error(`duplicateDocument: could not duplicate "${name}"`) }
		return copy;
	}

	/**
	 * The value of a script secret of the account (Settings > Script secrets), a string. name: the secret's name.
	 * defaultValue: what is returned when there is no such secret; null (default) throws instead.
	 */
	function secret(name, defaultValue=null){
		return scriptSecret(name, defaultValue); // secrets.js
	}

	/**
	 * Sends a GET request (await it: const res = await get(url)). url: an http(s) address; headers: an object
	 * {"Name": "value"}. The other server has to allow requests from this app (CORS), or it throws.
	 * Returns {status: 200, msg: the response's body, an object or array for JSON, else its text}.
	 */
	async function get(url, headers={}){
		return httpRequest("GET", url, undefined, headers, "get");
	}

	/**
	 * Sends a POST request (await it: const res = await post(url, {a: 1})). payload: an object, sent as JSON
	 * (Content-Type: application/json unless headers have one), or a string, sent as it is; headers: an object
	 * {"Name": "value"}. The other server has to allow requests from this app (CORS), or it throws.
	 * Returns {status: 201, msg: the response's body, an object or array for JSON, else its text}.
	 */
	async function post(url, payload={}, headers={}){
		return httpRequest("POST", url, payload, headers, "post");
	}

	return { locateHeading, locateById, getListElements, checkCheckbox, uncheckCheckbox, getDocTitle, setDocTitle, getRandomFromArray, createNotification, duplicateDocument, secret, getAllCheckboxes, get, post };
}

// the notebook's documents
function queryDocument(query, caller){
	// the one document {directory, index, doc} picks (duplicateDocument), throws when there is none or several
	if ( query === null || typeof query !== "object" || Array.isArray(query) ) { throw new TypeError(`${caller}: the query has to be an object {directory, index, doc}`) }
	const { directory=null, index=null, doc=null } = query;
	if ( directory !== null && typeof directory !== "string" ) { throw new TypeError(`${caller}: directory has to be a folder's path or name, "" or null`) }
	if ( doc !== null && typeof doc !== "string" ) { throw new TypeError(`${caller}: doc has to be a document's name or id, or null`) }
	if ( index !== null && !Number.isInteger(index) ) { throw new TypeError(`${caller}: index has to be a whole number (0, 1, ..., -1, -2, ...) or null`) }
	if ( doc === null && index === null ) { throw new Error(`${caller}: the query needs doc or index`) }
	let names = (getDocumentNamesFromLocalStorage() || []).sort((a, b) => a.localeCompare(b));
	if ( directory !== null ) {
		let folder = "";
		if ( directory.trim() ) {
			const { folders } = readFolders();
			const path = directory.trim().split(folderSeparator).map((part) => part.trim()).join(folderSeparator);
			const byName = folders.filter((f) => folderLabel(f) === path);
			if ( folders.includes(path) ) {
				folder = path;
			} else if ( byName.length === 1 ) {
				folder = byName[0];
			} else {
				throw new Error(byName.length ? `${caller}: ${byName.length} folders are named "${directory}", give its path (${byName.join(", ")})` : `${caller}: no folder "${directory}"`);
			}
		}
		names = names.filter((name) => folderOfDocument(name) === folder);
	}
	if ( doc !== null ) { names = names.filter((name) => name === doc || documentIdOf(name) === doc) }
	const where = `${doc === null ? "" : ` "${doc}"`}${directory === null ? "" : ` in ${directory.trim() ? `"${directory}"` : "no folder"}`}`;
	if ( index !== null ) {
		const name = names.at(index);
		if ( name === undefined ) { throw new Error(`${caller}: no document${where} at index ${index} (${names.length} match)`) }
		return name;
	}
	if ( names.length !== 1 ) { throw new Error(names.length ? `${caller}: ${names.length} documents${where} match, give an index` : `${caller}: no document${where}`) }
	return names[0];
}

// get() and post()
async function httpRequest(method, url, payload, headers, caller){
	let address;
	try {
		address = new URL(url);
	} catch ( err ) {
		throw new TypeError(`${caller}: "${url}" is not an address`);
	}
	if ( !["http:", "https:"].includes(address.protocol) ) { throw new TypeError(`${caller}: the address has to be http:// or https://, not ${address.protocol}`) }
	if ( headers === null || typeof headers !== "object" || Array.isArray(headers) ) { throw new TypeError(`${caller}: headers have to be an object {"Name": "value"}`) }
	const requestHeaders = new Headers();
	for ( const [name, value] of Object.entries(headers) ) {
		try {
			requestHeaders.set(name, String(value));
		} catch ( err ) {
			throw new TypeError(`${caller}: the header "${name}" can't be sent`);
		}
	}
	const options = { method, headers: requestHeaders, credentials: "omit" }; // the app's own cookies stay out
	if ( payload !== undefined && payload !== null ) {
		if ( typeof payload === "string" ) {
			options.body = payload;
		} else if ( typeof payload === "object" ) {
			options.body = JSON.stringify(payload);
			if ( !requestHeaders.has("Content-Type") ) { requestHeaders.set("Content-Type", "application/json") }
		} else {
			throw new TypeError(`${caller}: the payload has to be an object or a string, not ${typeof payload}`);
		}
	}
	let response;
	try {
		response = await fetch(address, options);
	} catch ( err ) {
		throw new Error(`${caller}: could not reach ${address.origin} (offline, or it doesn't allow requests from this app - CORS)`);
	}
	const text = await response.text();
	let msg = text;
	if ( text && /\bjson\b/i.test(response.headers.get("Content-Type") || "") ) {
		try { msg = JSON.parse(text) } catch ( err ) { /* not JSON after all: its text */ }
	}
	return { status: response.status, msg };
}
