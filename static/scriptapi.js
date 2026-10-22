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
	 * The document's title, its name (as in the name field, also before it is saved).
	 */
	function getDocTitle(){
		const tab = tabById(paneOfEditor(editor)?.tabId);
		return tab ? tabLabelName(tab) : "";
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
	 */
	function createNotification(text, type="info", timeout=notificationTimeout){
		return scriptNotification(String(text), type, timeout);
	}

	return { locateHeading, locateById, getListElements, getDocTitle, setDocTitle, getRandomFromArray, createNotification };
}
