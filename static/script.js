let autosaveEnabled = 0;
let caretPosition = null;
let wordCounterEnabled = true;

const notificationTimeout = 3000;
const notificationTimeoutLong = 10000;

const lastOpenedKey= "__lastOpened__";
const docPrefix = "__doc__";
const autosaveKey = "__autosave__";
const darkModeKey = "__darkModeEnabled__";

const fontStyleMark = `
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">`
loadAutosaveSetting();
setAutosaveText();

const documentNames = getDocumentNamesFromLocalStorage();
const userConsent = true; // TODO user consent handling
let darkModeEnabled = parseInt(localStorage.getItem(darkModeKey)) ? true : false;
if ( darkModeEnabled ) {
	toggleDarkMode();
	setDarkMode(1);
}
let boldState = false;
let italicState = false;
let underlineState = false;
let isLowWidthViewport = false;
handleWidth();

// Setup elements
const editorObject = document.getElementById("editor");
const documentNameObject = document.getElementById("doc-name");



// set document onload
window.addEventListener("load", function() { 
	loadLastOpenedDocument();
	if ( wordCounterEnabled ){
		handleWordCounter();
	}
})

// Setup Events
window.addEventListener("resize", handleWidth);
window.addEventListener("keydown", handleMobileScrollEvent);
document.getElementById("editor-container").addEventListener('keydown', () => {performAutoSave();handleWordCounter()});
document.getElementById("editor-container").addEventListener('click', updateCaretPosition);
document.getElementById("editor-container").addEventListener('keyup', updateCaretPosition);
document.getElementById("new-doc-btn").addEventListener('click', createNewDocument);
document.getElementById('editor-container').addEventListener('click', focusEditor);
document.getElementById("dark-mode-btn").addEventListener("click", toggleDarkMode);
document.getElementById("hamburger-menu").addEventListener("click", toggleMenu);
document.getElementById("export-btn").addEventListener("click", exportDocument);
document.getElementById("save-btn").addEventListener("click", saveDocumentToLocalStorage);
document.getElementById("open-doc-btn").addEventListener("click", openDocumentFromLocalStorage);
document.getElementById("import-doc-btn").addEventListener("click", importDocument);
document.getElementById("toggle-format-btn").addEventListener("click", toggleFormattingBar);
document.getElementById("spellcheck-btn").addEventListener("click", toggleSpellCheck);
document.getElementById("toggle-autosave-btn").addEventListener("click", toggleAutosave);
document.getElementById("generate-md").addEventListener("click", exportMarkdown);
document.getElementById("generate-pdf").addEventListener("click", generatePDF);
document.getElementById("contact").addEventListener("click", () => createNotification("Thank you!", 'info'))

function formatText(command) {
    const editor = document.getElementById("editor");

    if (command === "bold") {
        document.execCommand("bold", false, null);
		document.getElementById("bold-btn").classList.toggle("format-btn-active");
    } else if (command === "italic") {
        document.execCommand("italic", false, null);
		document.getElementById("italic-btn").classList.toggle("format-btn-active");
    } else if (command === "underline") {
        document.execCommand("underline", false, null);
		document.getElementById("underline-btn").classList.toggle("format-btn-active");
    } else if (command === "h1") {
        document.execCommand("formatBlock", false, "h1");
    } else if (command === "h2") {
        document.execCommand("formatBlock", false, "h2");
    } else if (command === "div"){
		document.execCommand("formatBlock", false, "div");
	} else if (command === "ul") {
        document.execCommand("insertUnorderedList", false, null);
    } else if (command === "ol") {
        document.execCommand("insertOrderedList", false, null);
    } else if (command === "hr") {
        document.execCommand("insertHorizontalRule", false, null);
		simulateEnter()
    } else if (command === "code") {
        document.execCommand("formatBlock", false, "pre");
    } else if (command === "inline-code") {
        document.execCommand("formatBlock", false, "code");
    } else if (command === "a"){
		createInsertLinkModal();
	}
	focusEditor();
}

function toggleDarkMode(){
    document.body.classList.toggle("dark-mode");
    document.querySelector("#editor-container").classList.toggle("dark-mode");
	document.querySelector(".top-bar-root").classList.toggle("dark-mode-dark");
	document.querySelector("#sub-bar").classList.toggle("dark-mode-medium");
	document.querySelectorAll(".notification-container").forEach((e) => e.classList.toggle("dark-mode-medium"))
	if ( darkModeEnabled) {
		setDarkMode(0);
	} else {
		setDarkMode(1);
	}
}

function setDarkMode(state){
	darkModeEnabled = state;
	localStorage.setItem(darkModeKey, state);
}

function focusEditor(){
    // Focus on the 'editable' div
	document.getElementById('menu').classList.remove("menu-opened");
    document.getElementById('editor').focus();
}

function toggleMenu(){
    const menu = document.getElementById("menu");
    //menu.style.display = menu.style.display === "grid" ? "none" : "grid";
	menu.classList.toggle("menu-opened");
	if ( isLowWidthViewport && menu.classList.contains("menu-opened")) { 
		document.getElementById("word-counter-container").classList.add("hidden")
	} else if ( !menu.classList.contains("menu-opened") && wordCounterEnabled){
		document.getElementById("word-counter-container").classList.remove("hidden")
	}
}

function exportDocument(){
	try {
		if (!validateDocumentName()){return}
    	const docName = document.getElementById("doc-name").value || "Untitled Document";
    	const content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getStyles()}</style>${fontStyleMark}</head><body><div id="content-container"><div id="content">${document.getElementById("editor").innerHTML}</div></div></body></html>`;
    	const blob = new Blob([content], { type: "html" });
    	const link = document.createElement("a");
    	link.href = URL.createObjectURL(blob);
		link.download = assignFileExtension(docName, "html");
		/*
		if ( docName.endsWith(".html")){
    		link.download = docName;
		} else{
    		link.download = `${docName}.html`;
		}
		*/
    	link.click();
		createNotification(`Document '${link.download}' saved on the machine!`, 'info')
	} catch ( err ) {
		informError("Could not export file as HTML!\n\nPlease report a bug", err)
	}
}

function importDocument(){
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".html";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
				fillDocName(file.name);
				const documentContent = stripImportToOnlyContent(event.target.result)
                fillEditorWithHTML(documentContent);
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

function fillDocName(name){
	document.getElementById("doc-name").value = name;
}
function fillEditorWithHTML(html){
    document.getElementById("editor").innerHTML = html;
}
function toggleFormattingBar(){
    const subBar = document.getElementById("sub-bar");
	const toggleFormatBtn = document.getElementById("toggle-format-btn");
    subBar.style.display = subBar.style.display === "none" ? "flex" : "none";
	if (subBar.style.display === "none"){
		toggleFormatBtn.innerText = "Toggle Formatting (It's off now)";
	} else {
		toggleFormatBtn.innerText = "Toggle Formatting (It's on now)";
	}
}

function toggleSpellCheck(){
    const editor = document.getElementById("editor");
	const spellCheckBtn = document.getElementById("spellcheck-btn");
    editor.spellcheck = !editor.spellcheck;
	spellCheckBtn.innerText = editor.spellcheck ? "Toggle Spell Check (It's on)" : "Toggle Spell Check (It's off)";

}

function getDocumentText(withHtml=true){
	return withHtml ? editorObject.innerHTML : editorObject.innerText;
}


function getDocumentName(){
	return documentNameObject.value;
}

function openDocumentFromLocalStorage(){
	let names = getDocumentNamesFromLocalStorage();
	createOpenDocumentModal(names);
}

function createModal(title, html){
	let modalContainer = document.createElement("div");
	modalContainer.setAttribute("id","modal");
	modalContainer.classList.add("modal-container");
	if ( darkModeEnabled) {
		modalContainer.classList.add("dark-mode-medium");
	}
	modalContainer.innerHTML =`
	<div class="modal-topbar" style="display:flex">
		<h3 class="modal-header">${title}</h3>
		<button class="close-button" onclick="closeAllModals()">X</button>
	</div>
	${html}
`
	createOverlay();
	document.body.appendChild(modalContainer)
}
function createOpenDocumentModal(documentNames){
	let namesElements = "";
	if (! documentNames.length ){
		namesElements += `<button onclick="showAlert('Just create one :)!', 'info')">You don't have any saved documents</button>`
	}
	for ( let name of documentNames ){
		namesElements += `<div class="double-button-div"><button onclick="loadDocumentFromLocalStorage('${name}');closeAllModals()">${name}</button><button class="delete-btn" onclick="deleteDocumentInLocalStorage('${name}');">Delete</button></div>\n`
	}
	createModal("Open document", `<div>This modal design is temporary, I promise</div>
	<div id="menu-modal" class="menu overflow">
		${namesElements}
	</div>`);


}

function saveDocumentToLocalStorage(){
	try { 
		let documentNameValue = getDocumentName();
		let documentText = getDocumentText();
		if ( !validateDocumentName() ){return}
		localStorage.setItem(docPrefix + documentNameValue, documentText);
		saveAsLastOpenedDocument(documentNameValue);
		createNotification(`Document '${documentNameValue}' saved!`, "info");
	} catch ( err ) {
		informError("Could not save document!", err)
	}
}

function getDocumentNamesFromLocalStorage(){
	const documentNames = [];
	for ( let ls_object of Object.entries(localStorage) ){
		let key = ls_object[0];
		if ( key.startsWith(docPrefix)){
			let documentName = key.replace(docPrefix, '');
			documentNames.push(documentName);
		}
	}
	return documentNames;
}

function checkIfDocumentNameExists(name){
	return getDocumentNamesFromLocalStorage().includes(name);
}

function performAutoSave(){
	try {
		if (!autosaveEnabled){return}
		if (!validateDocumentName(false)){return};
		let name = getDocumentName();
		let content = getDocumentText();
		if (!content){return}
		localStorage.setItem(docPrefix + name, content);
		saveAsLastOpenedDocument(name)
	} catch ( err ) {
		informError("Autosave failure!\n\nPlease save manually!\n\nyou may report a bug or disable autosave", err)
	}
}

function validateDocumentName(isShowAlert=true){
	// returns true or false
	if ( !getDocumentName() ){
		if ( isShowAlert ) {createNotification("Document name is empty!", "error", notificationTimeoutLong)}
		return false
	}
	return true
	
}


function showAlert(text, type){
	// type: info, warning, error
	// TODO alert handlings
	window.alert(text);
}

function showConfirm(text){
	// type: info, warning, error
	// TODO alert handlings
	return confirm(text);
}
function createOverlay(){
	let overlay = document.createElement("div");
	overlay.setAttribute("id","overlay");
	overlay.setAttribute("onclick", "closeAllModals()")
	document.body.appendChild(overlay);
}

function deleteOverlay(){
	document.getElementById("overlay").remove()
}

function getDocumentTextFromLocalStorage(name){
	let text = localStorage.getItem(docPrefix + name);
	if (!text) {
		informError(`Document with name "${name}" has not been found!`, '');
		return null
	}
	return text;
}

function loadDocumentFromLocalStorage(name){
	let text = getDocumentTextFromLocalStorage(name);
	if ( !text ){return false}
	fillEditorWithHTML(text);
	fillDocName(name);
	saveAsLastOpenedDocument();
	return true
}

function deleteDocumentInLocalStorage(name){
	if ( showConfirm(`Delete document '${name}' ?`) ){
		localStorage.removeItem(docPrefix + name);
		closeAllModals();
		openDocumentFromLocalStorage();
	}
}

function closeAllModals(){
	document.querySelectorAll(".modal-container").forEach((e) => {e.remove()})
	deleteOverlay();
}

function saveAsLastOpenedDocument(name=null){
	if ( name === null ) {
		name = getDocumentName();
	}
	localStorage.setItem(lastOpenedKey, name)
}

function loadLastOpenedDocument(){
	let documentName = localStorage.getItem(lastOpenedKey);
	if ( documentName && documentName != "null"){
		if ( loadDocumentFromLocalStorage(documentName)) {return};
		saveAsLastOpenedDocument(null);
		return
	}  else {
	saveAsLastOpenedDocument(null);
	}
}

function exportMarkdown(){
	try {
		if (!validateDocumentName()){return}
		const docName = getDocumentName();
		const mdContent = getContentAsMarkdown();
		const blob = new Blob([mdContent], { type: "text"});
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		fileName = assignFileExtension(docName,"markdown");
		link.download = fileName;
		link.click();
		createNotification(`Document '${link.download}' saved on the machine!`, 'info')
	} catch ( err ) {
		informError("Cannot export Markdown!\n\nPlese report this bug", err);
	}
	
}

function generatePDF(){
	createNotification("PDFs are not yet supported :(","warning")
}

function getStyles(){
	const sheet = document.styleSheets[0];
	const css = Array.from(sheet.cssRules).map(rule => rule.cssText).join(' ');
	return css;

}
function stripImportToOnlyContent(html){
	let output = html.replace(/[\s\S]*id="content">/, "")
	return output = output.replace("</div></div></body></html>", "")

}

function handleWordCounter(){
	const counterEl = document.getElementById("word-counter-container")
	if ( wordCounterEnabled ){
		try {
			counterEl.innerText = `${countWords()} words`;
			counterEl.classList.remove("hidden");
		} catch ( err ) {
			informError("Word Counter error occured!", err)
		}

	} else {
		counterEl.classList.add("hidden");
	}
}

function updateWordCounter(){
	document.getElementById("word-counter-container").innerText = countWords();
}

function toggleAutosave(){
	if (autosaveEnabled) {
		autosaveEnabled = 0
	} else { 
		autosaveEnabled = 1
	};

	setAutosaveText();
	saveAutosaveSetting();
}

function loadAutosaveSetting(){
	let ls_setting = parseInt(localStorage.getItem(autosaveKey));

	if ( ls_setting ){
		autosaveEnabled = 1;
	} else {
		autosaveEnabled = 0;
	}
}
function saveAutosaveSetting(){
	localStorage.setItem(autosaveKey, autosaveEnabled);
}
function setAutosaveText(){
	const autosaveBtn = document.getElementById("toggle-autosave-btn");
	autosaveBtn.innerText = autosaveEnabled ? "Toggle Autosave (It's on now)" : "Toggle Autosave (It's off now)"
}
function createNewDocument(){
	let previousAutosave = autosaveEnabled;
	try {
		autosaveEnabled = false;
		fillDocName("");
		fillEditorWithHTML("")
	} catch(error){
		createNotification("There were some problems with new document creation!", "error")
	autosaveEnabled = previousAutosave;
	}
}

function getContentAsMarkdown(){
	let content = getDocumentText();
	const parser = new DOMParser();
    const doc = parser.parseFromString(content, "text/html");

    function traverse(element) {
        let markdown = "";

        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                markdown += child.nodeValue;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();

                switch (tagName) {
                    case "h1":
                        markdown += `# ${traverse(child)}\n`;
                        break;
                    case "h2":
                        markdown += `## ${traverse(child)}\n`;
                        break;
                    case "h3":
                        markdown += `### ${traverse(child)}\n`;
                        break;
                    case "hr":
                        markdown += "---\n";
                        break;
                    case "div":
                        markdown += traverse(child) + "\n";
                        break;
                    case "p":
                        markdown += traverse(child) + "\n";
                        break;
                    case "pre":
                        markdown += `\`\`\`\n${traverse(child)}\n\`\`\`\n`;
                        break;
                    case "b":
                        markdown += `__${traverse(child)}__`;
                        break;
                    case "i":
                        markdown += `_${traverse(child)}_`;
                        break;
                    case "b" && "i":
                    case "i" && "b":
                        markdown += `***${traverse(child)}***`;
                        break;
                    case "u":
                        markdown += `<ins>${traverse(child)}</ins>`;
                        break;
                    case "ol":
                        let i = 1;
                        for (const li of child.querySelectorAll("li")) {
                            markdown += `${i++}. ${traverse(li)}\n`;
                        }
                        break;
                    case "ul":
                        for (const li of child.querySelectorAll("li")) {
                            markdown += `- ${traverse(li)}\n`;
                        }
                        break;
                    case "li":
                        markdown += traverse(child) + "\n";
                        break;
                    case "br":
                        markdown += "\n";
                        break;
					case "a":
						const href = child.getAttribute("href") || "#";
						const text = traverse(child).trim();
						markdown += `[${text}](${href})`
						break;
                    default:
                        markdown += traverse(child);
                        break;
                }
            }
        }

        return markdown;
    }

    return traverse(doc.body).trim();
}


function assignFileExtension(name, extension){
	const removeExtensions = ["html", "txt", "md", "markdown"]
	for ( let e of removeExtensions ){
		name = name.replace(`.${e}`, "");
	}
	name += `.${extension}`
	return name
	

}

function simulateEnter() {
    const editor = document.querySelector("#editor");
    const newLine = document.createElement("div");
    newLine.innerHTML = "<br>";

    editor.appendChild(newLine);

    // Optionally, move the focus to the new line
    const range = document.createRange();
    const sel = window.getSelection();
    range.setStart(newLine, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

function getAllLocalStorageItems() {
	const data = {}
	for ( var i = 0, len = localStorage.length; i < len; ++i ) {
	  const key = localStorage.key( i );
	  data[key] = localStorage.getItem( localStorage.key( i ) );
	}
	return data
}

function loadDataFromLocalStorageJson(jsonObject){
	let dataObject = JSON.parse(jsonObject);
	if ( typeof(dataObject) != 'object' ){
		// this is a check for complex documents
		dataObject = JSON.parse(dataObject);
	}

	for ( const [key, value] of Object.entries(dataObject) ){
		if ( !key.startsWith(docPrefix) ) { continue }


		// check for documents that are different
		// TODO add support for current document
		const existingDocument = localStorage.getItem(key)  
		if ( existingDocument === value ) { continue }    // if document is the same, don't overwrite
		else if ( !confirm(`!Do you want to overwrite '${key.replace(docPrefix, "")}'?`)){ continue } // for edited documents in both sources 

		// set remote value
		localStorage.setItem(key, value);
	}
	loadLastOpenedDocument();
}


function purgeLocalStorage(){
	if ( confirm("Do you really want to delete everything from Browser?") ){
		localStorage.clear();
	}
}

function handleWidth(){
	const width = (window.innerWidth > 0) ? window.innerWidth : screen.width;
	isLowWidthViewport = ( width < 1000 ) ? true : false;
	if (  isLowWidthViewport && document.getElementById("menu").classList.contains("menu-opened") ) {
		document.getElementById("word-counter-container").classList.add("hidden");
	} else if ( wordCounterEnabled ){
		document.getElementById("word-counter-container").classList.remove("hidden");
	}
}

function handleMobileScrollEvent(e){
	// FIXME doesn't work well on Chrome mobile :'( But where is the issue? Maybe in Chrome itself?
	return
	if ( !isLowWidthViewport ) { return }

	if ( e.keyCode === 13 ){
		// Enter
		const lastElement = document.querySelector("#editor > :last-child");
		if ( isElementInViewport(lastElement)){ return}
			window.alert('scrolll');
			lastElement.scrollIntoView();
		
	}

}
function isElementInViewport (el) {

    // Special bonus for those using jQuery
    if (typeof jQuery === "function" && el instanceof jQuery) {
        el = el[0];
    }

    var rect = el.getBoundingClientRect();

    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) && /* or $(window).height() */
        rect.right <= (window.innerWidth || document.documentElement.clientWidth) /* or $(window).width() */
    );
}

function createNotification( text, type, timeout=notificationTimeout ) {
	// type: info, warning, error
	try {
		handleExistingNotifications(text, type);
		const n_div = document.createElement("div");
		n_div.setAttribute("class" ,`notification-container notification-${type}`);
		if ( darkModeEnabled ){ n_div.classList.add('dark-mode-medium')}

		const div_text = document.createElement("div");
		div_text.setAttribute("class", "notification-text");
		div_text.innerText = text;

		const close = document.createElement("button");
		close.setAttribute("class", "notification-close");
		close.innerText = "X";
		close.addEventListener("click", () => {closeNotification(n_div)});
		
		n_div.appendChild(div_text);
		n_div.appendChild(close);

		document.querySelector("#notifications-container").appendChild(n_div)

		setTimeout(() => closeNotification(n_div), timeout);
		return n_div;
	} catch ( err ) {
		window.alert(`${text}\n\n\n${err}`)
	}
}

function closeNotification(notificationDiv){
	notificationDiv.classList.add("hidden");
	setTimeout(() => notificationDiv.remove(), 800)
}

function handleExistingNotifications(text, type){
	document.querySelectorAll(".notification-container").forEach((e) => {
		if ( e.classList.contains(`notification-${type}`) && e.childNodes[0].innerText === text ) {
			e.remove();
		} 
	})
}

function informError(notificationText, error){
	console.error(notificationText, error);
	createNotification(notificationText, "error", notificationTimeoutLong);
}

function createInsertLinkModal(){
	if ( document.querySelector(".insert-link-modal") ) { closeInsertLinkModal();return }
	const c_div = document.createElement("div");
	c_div.setAttribute("class","format-btn insert-link-modal");
	c_div.innerHTML = `
	<div class="insert-link-form">
		<label for='link-name'>Link Text</label>
		<input id='link-name' type='text' value="${caretPosition.cloneContents().textContent}">
		<label for='link-href'>Link url</label>
		<input id='link-href' type='text'>
	</div>
	`
	const b_div = document.createElement("div");
	b_div.classList.add("create-link-buttons")

	const btn = document.createElement("button");
	btn.innerText = "Add";
	btn.addEventListener("click", insertLink);

	const cnl = document.createElement("button");
	cnl.innerText = "Cancel";
	cnl.addEventListener("click", closeInsertLinkModal);

	b_div.appendChild(btn);
	b_div.appendChild(cnl);

	c_div.appendChild(b_div)
	document.body.appendChild(c_div)
}

function insertLink(){
	const href = document.getElementById("link-href").value;
	const text = document.getElementById("link-name").value;
	if ( !href || !text ) { informError("Both Text and Link have to be provided!","");return}
	const html = `<a contenteditable="false" href="${href}" target="about:blank">${text}</a>`
	injectHtml(html)
	document.execCommand('createlink', false, href)
	closeInsertLinkModal();
}

function closeInsertLinkModal(){
	document.querySelectorAll('.insert-link-modal').forEach((e) => e.remove());
}

function injectHtml(html){
	// inserts HTML into pointer place
	if ( caretPosition ) {
		try { 
			const newNode = document.createElement("span");
			newNode.innerHTML = html;
			caretPosition.deleteContents(); // delete selected text if it's selected
			caretPosition.insertNode(newNode);
		} catch ( err ) {
			informError("Cannot perform action!", err)
		}
	} else {
		const newNode = document.createElement("div");
		newNode.innerHTML = html;
		document.querySelector("#editor").appendChild(newNode)
	}
}

function updateCaretPosition(){
	const selection = window.getSelection();
	if ( selection.rangeCount > 0 ) {
		caretPosition = selection.getRangeAt(0);
	}
}

function countWords() {
  return getDocumentText(false).trim().split(/\s+/).length;
}

function saveSetting(key, value){
	localStorage.setItem(key, value);
}

