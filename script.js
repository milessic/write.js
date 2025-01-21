let autoSaveEnabled = true;
const fontStyleMark = `
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">`
const lastOpenedKey= "__lastOpened__";
const docPrefix = "__doc_";
const documentNames = getDocumentNamesFromLocalStorage();
const userConsent = true; // TODO user consent handling
let darkModeEnabled = parseInt(localStorage.getItem("darkModeEnabled")) ? true : false;
if ( darkModeEnabled ) {
	toggleDarkMode();
	setDarkMode(1);
}
let boldState = false;
let italicState = false;
let underlineState = false;

// Setup elements
const editorObject = document.getElementById("editor");
const documentNameObject = document.getElementById("doc-name");

let editorObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
			performAutoSave();
        });
    });
let config = { attributes: true, childList: true, characterData: true }

    // pass in the target node, as well as the observer options
editorObserver.observe(editorObject, config);


// set document onload
document.onload = loadLastOpenedDocument()

// Setup Events
document.body.addEventListener('keydown', performAutoSave)
document.getElementById('editor-container').addEventListener('click', focusEditor);
document.getElementById("dark-mode-btn").addEventListener("click", toggleDarkMode);
document.getElementById("hamburger-menu").addEventListener("click", toggleMenu);
document.getElementById("export-btn").addEventListener("click", exportDocument);
document.getElementById("save-btn").addEventListener("click", saveDocumentToLocalStorage);
document.getElementById("open-doc-btn").addEventListener("click", openDocumentFromLocalStorage);
document.getElementById("import-doc-btn").addEventListener("click", importDocument);
document.getElementById("toggle-format-btn").addEventListener("click", toggleFormattingBar);
document.getElementById("spellcheck-btn").addEventListener("click", toggleSpellCheck);
document.getElementById("generate-pdf").addEventListener("click", generatePDF);

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
    } else if (command === "code") {
        document.execCommand("formatBlock", false, "pre");
    } else if (command === "inline-code") {
        document.execCommand("formatBlock", false, "code");
    }
	focusEditor();
}

function toggleDarkMode(){
    document.body.classList.toggle("dark-mode");
	document.querySelector(".top-bar-root").classList.toggle("dark-mode-dark");
	document.querySelector("#sub-bar").classList.toggle("dark-mode-medium");
	if ( darkModeEnabled) {
		setDarkMode(0);
	} else {
		setDarkMode(1);
	}
}

function setDarkMode(state){
	darkModeEnabled = state;
	localStorage.setItem("darkModeEnabled", state);
}

function focusEditor(){
    // Focus on the 'editable' div
    document.getElementById('editor').focus();
}

function toggleMenu(){
    const menu = document.getElementById("menu");
    menu.style.display = menu.style.display === "block" ? "none" : "block";
}

function exportDocument(){
	if (!validateDocumentName()){return}
    const docName = document.getElementById("doc-name").value || "Untitled Document";
    const content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getStyles()}</style>${fontStyleMark}</head><body><div id="content-container"><div id="content">${document.getElementById("editor").innerHTML}</div></div></body></html>`;
    const blob = new Blob([content], { type: "html" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
	if ( docName.endsWith(".html")){
    	link.download = docName;
	} else{
    	link.download = `${docName}.html`;
	}
    link.click();
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
    subBar.style.display = subBar.style.display === "none" ? "flex" : "none";
}

function toggleSpellCheck(){
    const editor = document.getElementById("editor");
    editor.spellcheck = !editor.spellcheck;
}

function getDocumentText(){
	return editorObject.innerHTML
}

function getDocumentName(){
	return documentNameObject.value;
}

function openDocumentFromLocalStorage(){
	let names = getDocumentNamesFromLocalStorage();
	createOpenDocumentModal(names);
}

function createOpenDocumentModal(documentNames){
	createOverlay();
	let namesElements = "";
	if (! documentNames.length ){
		namesElements += `<button onclick="showAlert('Just create one :)!', 'info')">You don't have any saved documents</button>`
	}
	for ( let name of documentNames ){
		namesElements += `<button onclick="loadDocumentFromLocalStorage('${name}');closeAllModals()">${name}</button>\n`
	}

	let modalContainer = document.createElement("div");
	modalContainer.setAttribute("id","modal");
	modalContainer.classList.add("modal-container");
	if ( darkModeEnabled) {
		modalContainer.classList.add("dark-mode-medium");
	}
	modalContainer.innerHTML =`
	<div class="modal-topbar" style="display:flex">
		<h3 class="modal-header">Load Document</h3>
		<button class="close-button" onclick="document.getElementById('modal').remove();deleteOverlay()">X</div>
	</div>
	<div>This modal is temporary.</div>
	<div id="menu-modal" class="menu overflow">
		${namesElements}
		</div>
</div>
`
	document.body.appendChild(modalContainer)

}

function saveDocumentToLocalStorage(){
	let documentNameValue = getDocumentName();
	let documentText = getDocumentText();
	if ( !validateDocumentName() ){return}
	localStorage.setItem(docPrefix + documentNameValue, documentText);
	saveAsLastOpenedDocument(documentNameValue);
	showAlert(`Document '${documentNameValue}' saved!`, "info");
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
	if (!autoSaveEnabled){return}
	validateDocumentName();
	localStorage.setItem(docPrefix + getDocumentName(), getDocumentText());
	console.log('autosaved')
}

function validateDocumentName(){
	// returns true or false
	if ( !getDocumentName() ){
		showAlert("Document name is empty!", "error");
		return false
	}
	return true
	
}

function showAlert(text, type){
	// type: info, warning, error
	// TODO alert handlings
	window.alert(text);
}

function createOverlay(){
	let overlay = document.createElement("div");
	overlay.setAttribute("id","overlay");
	document.body.appendChild(overlay);
}

function deleteOverlay(){
	document.getElementById("overlay").remove()
}

function getDocumentTextFromLocalStorage(name){
	let text = localStorage.getItem(docPrefix + name);
	if (!text) {
		showAlert(`Document with name "${name}" has not been found!`, "error");
		console.error(`localStorage document '${docPrefix}${name}' has not been found!`)
		return null
	}
	return text;
}

function loadDocumentFromLocalStorage(name){
	let text = getDocumentTextFromLocalStorage(name);
	if ( !text ){return}
	fillEditorWithHTML(text);
	fillDocName(name);
}

function closeAllModals(){
	document.querySelectorAll(".modal-container").forEach((e) => {e.remove()})
	deleteOverlay();
}

function saveAsLastOpenedDocument(name){
	localStorage.setItem(lastOpenedKey, name)
}

function loadLastOpenedDocument(){
	let documentName = localStorage.getItem(lastOpenedKey);
	if ( documentName ){
		loadDocumentFromLocalStorage(documentName);
	}
}

function generatePDF(){
	showAlert("PDFs are not yet supported :(","warning")
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
