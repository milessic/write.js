const baseTitle = "Write.JS";
const userLoggedInKey = "__userLoggedIn__";
const userConsentKey = "__userConsent__";
const lastOpenedKey= "__lastOpened__";
const docPrefix = "__doc__";
const autosaveKey = "__autosave__";
const darkModeKey = "__darkModeEnabled__";

let autosaveEnabled = 0;
let documentNames = [];
let caretPosition = null;
let selection = null;
let wordCounterEnabled = true;
let indentSize = 4;
let userLoggedIn = getUserLoggedIn();

const notificationTimeoutShort = 1500;
const notificationTimeout = 3000;
const notificationTimeoutLong = 10000;
const base64icon = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJmZWF0aGVyIGZlYXRoZXItZWRpdCI+PHBhdGggZD0iTTExIDRINGEyIDIgMCAwIDAtMiAydjE0YTIgMiAwIDAgMCAyIDJoMTRhMiAyIDAgMCAwIDItMnYtNyI+PC9wYXRoPjxwYXRoIGQ9Ik0xOC41IDIuNWEyLjEyMSAyLjEyMSAwIDAgMSAzIDNMMTIgMTVsLTQgMSAxLTQgOS41LTkuNXoiPjwvcGF0aD48L3N2Zz4=`
const softReturnText = `
`


let userConsent = localStorage.getItem(userConsentKey);
let darkModeEnabled = 0;
darkModeEnabled = parseInt(localStorage.getItem(darkModeKey)) ? true : false;
if ( darkModeEnabled ) {
	toggleDarkMode();
	setDarkMode(1);
}

document.querySelector("body").classList.add("transitions-enabled");
const fontStyleMark = `
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
	<link href="https://fonts.googleapis.com/css2?family=Cousine:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet">`

if ( userConsent ){
	loadAutosaveSetting();
	setAutosaveText();
	documentNames = getDocumentNamesFromLocalStorage();
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
	userConsentModal();
	if ( userConsent ) { loadLastOpenedDocument();}
	if ( wordCounterEnabled ){
		handleWordCounter();
	};
	handleQueries();
	setTimeout(()=>{
		createNotification("This is a development environemnt!<hr>In case of questions: <button id='this-is-dev-btn'>Contact Write.JS</button>","warning", notificationTimeoutLong*2, true);
		document.getElementById("this-is-dev-btn").addEventListener("click", () => {
			const a = document.createElement("a");
			a.href = 'mailto:writejs.help@gmail.com?subject=Write.JS question';
			document.body.appendChild(a);
			a.click();
			a.remove();
		})
	}, 4000)
})

// Setup Events
window.addEventListener("resize", handleWidth);
window.addEventListener("keydown", handleMobileScrollEvent);
document.getElementById("editor-container").addEventListener('keydown', (e) => {performAutoSave();changeTabBehavior(e);handleCheckboxEnter(e)});
document.getElementById("editor-container").addEventListener('click', updateCaretPosition);
document.getElementById("editor-container").addEventListener('keyup', (e) => {updateCaretPosition();handleWordCounter()});
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
document.getElementById("insert-or-append-html").addEventListener("click", createInsertHtmlModal);
document.getElementById("insert-or-append-markdown").addEventListener("click", createInsertMarkdownModal);
document.getElementById("generate-md").addEventListener("click", exportMarkdown);
document.getElementById("copy-md").addEventListener("click", copyMarkdown);
document.getElementById("generate-pdf").addEventListener("click", generatePDF);
document.getElementById("contact").addEventListener("click", () => createNotification("Thank you!", 'info'))
documentNameObject.addEventListener("change", updateTitle);
// toolbar
document.getElementById("tb-btn-h1").addEventListener("click", () => { formatText("h1") } );
document.getElementById("tb-btn-h2").addEventListener("click", () => { formatText("h2") } );
document.getElementById("tb-btn-text").addEventListener("click", () => { formatText("div") } );
document.getElementById("tb-btn-bl").addEventListener("click", () => { formatText("ul") } );
document.getElementById("tb-btn-nl").addEventListener("click", () => { formatText("ol") } );
document.getElementById("tb-btn-cl").addEventListener("click", () => { formatText("checkbox") } );
document.getElementById("tb-btn-hr").addEventListener("click", () => { formatText("hr") } );
document.getElementById("tb-btn-code").addEventListener("click", () => { formatText("code") } );
document.getElementById("tb-btn-bold").addEventListener("click", () => { formatText("bold") } );
document.getElementById("tb-btn-italic").addEventListener("click", () => { formatText("italic") } );
document.getElementById("tb-btn-underline").addEventListener("click", () => { formatText("underline") } );
document.getElementById("tb-btn-link").addEventListener("click", () => { formatText("a") } );
document.getElementById("tb-btn-softreturn").addEventListener("click", () => { formatText("softreturn") } );
document.getElementById("tb-btn-inserttab").addEventListener("click", () => { formatText("inserttab") } );


function formatText(command) {
    const editor = document.getElementById("editor");

    if (command === "bold") {
        document.execCommand("bold", false, null);
    } else if (command === "italic") {
        document.execCommand("italic", false, null);
    } else if (command === "underline") {
        document.execCommand("underline", false, null);
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
	} else if (command === "softreturn"){
		injectIntoDocument(softReturnText, false);
		adjustSelectionRange(1);
	} else if (command === "inserttab") {
		insertTab();
	} else if ( command === "checkbox" ) {
		insertCheckbox();
	} else {
		console.error("Not supported command - ", command);
	}
	focusEditor();
	performAutoSave();
}

function toggleDarkMode(setDarkModeState=true){
    document.body.classList.toggle("dark-mode");
    document.querySelector("#editor-container").classList.toggle("dark-mode");
	document.querySelector(".top-bar-root").classList.toggle("dark-mode-dark");
	document.querySelector("#sub-bar").classList.toggle("dark-mode-medium");
	document.querySelectorAll(".notification-container").forEach((e) => e.classList.toggle("dark-mode-medium"))
	if (!setDarkModeState){return}
	if ( darkModeEnabled) {
		setDarkMode(0);
	} else {
		setDarkMode(1);
	}
}

function setDarkMode(state){
	darkModeEnabled = state;
	if ( validateUserConsent(false)){
		localStorage.setItem(darkModeKey, state);
	}
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

function getDocumntContentToExport(){
	return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${getStyles()}</style>${fontStyleMark}</head><body><div id="content-container"><div id="content">${document.getElementById("editor").innerHTML}</div></div></body></html>`;
}
function exportDocument(){
	try {
		if (!validateDocumentName()){return}
    	const docName = document.getElementById("doc-name").value || "Untitled Document";
    	const content = getDocumntContentToExport();
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
		informError("C,.markdown,.MD,mdould not export file as HTML!\n\nPlease report a bug", err)
	}
}

function importDocument(){
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".html,.markdown,.MD,md";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
        	const fileType = file.type;
            const reader = new FileReader();
            reader.onload = (event) => {
				fillDocName(file.name);
				let documentContent = stripImportToOnlyContent(event.target.result)
				// Markdown
				if ( fileType === "text/markdown"){
					if (window.confirm("Load Markdown as HTML?")){
						documentContent = markdownToHtml(documentContent);

					}
				}
                fillEditorWithHTML(documentContent);
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

function fillDocName(name){
	document.getElementById("doc-name").value = name;
	updateTitle();
}
function fillEditorWithHTML(html, append=false){
	if (append){
    	document.getElementById("editor").innerHTML = `${editor.innerHTML}<br>${html}`;
		window.scrollTo(0, 1000);
		return
	}
    document.getElementById("editor").innerHTML = html;
	window.scrollTo(0, 1000);
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
	if ( !validateUserConsent() ) { return } 
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
	<div class="modal-content">
		${html}
	</div>
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
	<div id="search-container">
	<label for="modal-search">Type to begin search</label>
	<input id="modal-search" placeholder="..." type="text">
	<button id="clear-modal-search">Clear</button>
	</div>
	<div id="menu-modal" class="menu overflow">
		${namesElements}
	</div>`);
	document.querySelector(".modal-content").classList.add("no-margin-left-on-mobile");
	setEventForFilteringChildrenNodes("#modal-search", "#menu-modal .double-button-div", "#clear-modal-search")


}

function saveDocumentToLocalStorage(){
	if ( !validateUserConsent() ) { return }
	let documentNameValue = ''
	try { 
		documentNameValue = getDocumentName();
		let documentText = getDocumentText();
		if ( !validateDocumentName() ){return}
		localStorage.setItem(docPrefix + documentNameValue, documentText);
		setUserLoggedIn(null);
		setUserConsent(userConsent);
		saveAsLastOpenedDocument(documentNameValue);
	} catch ( err ) {
		informError("Could not save document!", err)
	}
	try{
		createNotification(`Document '${documentNameValue}' saved!`, "info");
	} catch ( err ) {
		informError("Could not create notification that confirms that document is saved ( document is saved )", err)
	}
}

function getDocumentNamesFromLocalStorage(){
	if ( !validateUserConsent() ) { return }
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
	if ( !validateUserConsent() ) { return }
	return getDocumentNamesFromLocalStorage().includes(name);
}

function performAutoSave(){
	if (!autosaveEnabled){return}
	if ( !validateUserConsent() ) { return }
	try {
		if (!validateDocumentName(false)){return};
		let name = getDocumentName();
		let content = getDocumentText();
		if (!content){return}
		localStorage.setItem(docPrefix + name, content);
		saveAsLastOpenedDocument(name)
		if ( typeof handleRemoteAutosave !== "undefined" ){
			handleRemoteAutosave();
		}
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
	document.querySelectorAll("#overlay").forEach((e) => e.remove());
}

function getDocumentTextFromLocalStorage(name){
	if ( !validateUserConsent() ) { return }
	let text = localStorage.getItem(docPrefix + name);
	if (!text) {
		informError(`Document with name "${name}" has not been found!`, '');
		return null
	}
	return text;
}

function loadDocumentFromLocalStorage(name){
	if ( !validateUserConsent() ) { return }
	let text = getDocumentTextFromLocalStorage(name);
	if ( !text ){return false}
	fillEditorWithHTML(text);
	fillDocName(name);
	saveAsLastOpenedDocument();
	handleWordCounter();
	return true
}

function deleteDocumentInLocalStorage(name){
	if ( !validateUserConsent() ) { return }
	if ( showConfirm(`Delete document '${name}' ?`) ){
		localStorage.removeItem(docPrefix + name);
		if ( sendNotebook !== 'undefined' ) {
			if ( remoteAutoSaveEnabled || showConfirm("Do you want to send updated Notebook to the cloud?") ){
				sendNotebookForce();
			}
		}
		closeAllModals();
		openDocumentFromLocalStorage();
	}
}

function closeAllModals(...excludeTitles){
	if ( excludeTitles.length ){
		document.querySelectorAll(".modal-container").forEach((e) => {
			excludeTitles.forEach( (t) => {
				if ( !e.querySelector("h3").innerText.startsWith(t)){
					e.remove();
					deleteOverlay();
				} 
			})
		})
		return
	}
	document.querySelectorAll(".modal-container").forEach((e) => { e.remove() })
	deleteOverlay();
}

function saveAsLastOpenedDocument(name=null){
	if ( !validateUserConsent() ) { return }
	if ( name === null ) {
		name = getDocumentName();
	}
	localStorage.setItem(lastOpenedKey, name)
}

function loadLastOpenedDocument(){
	if ( !validateUserConsent() ) { return }
	let documentName = localStorage.getItem(lastOpenedKey);
	if ( documentName && documentName != "null"){
		if ( loadDocumentFromLocalStorage(documentName)) {return};
		saveAsLastOpenedDocument(null);
		return
	}  else {
	saveAsLastOpenedDocument(null);
	}
}

function markdownToHtml(markdown) {
	const converter = new showdown.Converter();
	return converter.makeHtml(markdown);
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
			const wordCount = countWords();
			counterEl.innerText = `${wordCount} word` + (!wordCount || wordCount > 1 ? 's' : '');
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
	if ( !validateUserConsent() ) { autosaveEnabled = 0; return}
	if (autosaveEnabled) {
		autosaveEnabled = 0
	} else { 
		autosaveEnabled = 1
	};

	setAutosaveText();
	saveAutosaveSetting();
}

function loadAutosaveSetting(){
	if ( !validateUserConsent() ) { return }
	let ls_setting = parseInt(localStorage.getItem(autosaveKey));

	if ( ls_setting ){
		autosaveEnabled = 1;
	} else {
		autosaveEnabled = 0;
	}
}
function saveAutosaveSetting(){
	if ( !validateUserConsent() ) { return }
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
		handleWordCounter();
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
	if ( !validateUserConsent() ) { return [] }
	const data = {}
	for ( var i = 0, len = localStorage.length; i < len; ++i ) {
	  const key = localStorage.key( i );
	  data[key] = localStorage.getItem( localStorage.key( i ) );
	}
	return data
}

function loadDataFromLocalStorageJson(jsonObject, excludeCurrentDocument=false, loadLastOpened=true){
	if ( !validateUserConsent() ) { return }
	let dataObject = JSON.parse(jsonObject);
	if ( typeof(dataObject) != 'object' ){
		// this is a check for complex documents
		dataObject = JSON.parse(dataObject);
	}

	for ( const [key, value] of Object.entries(dataObject) ){
		if ( key  === lastOpenedKey ) { continue }
		// check for documents that are different
		// TODO add support for current document
		if ( key === docPrefix + getDocumentName() && excludeCurrentDocument ) { console.log('skipping current doc');continue }
		if ( key === userLoggedInKey ) { continue }
		const existingDocument = localStorage.getItem(key)  
		if ( existingDocument === value ) { continue }    // if document is the same, don't overwrite
		else if ( existingDocument != null && !showConfirm(`!Do you want to overwrite '${key.replace(docPrefix, "")}'?`)){ continue } // for edited documents in both sources 

		// set remote value
		localStorage.setItem(key, value);
	}
	if (loadLastOpened){
		loadLastOpenedDocument();
	}
}


function purgeLocalStorage(doConfirm=true){
	if ( web_env && !doConfirm ){ 
		localStorage.clear();
	} else if ( confirm("Do you really want to delete everything from Browser?") ){
		localStorage.clear();
	}
	setUserLoggedIn(userLoggedIn);
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

function createNotification( text, type, timeout=notificationTimeout, isHtml=false) {
	// type: info, warning, error
	handleExistingNotifications(text, type, isHtml);
	try {
		const n_div = document.createElement("div");
		n_div.setAttribute("class" ,`notification-container notification-${type}`);
		if ( darkModeEnabled ){ n_div.classList.add('dark-mode-medium')}

		const div_text = document.createElement("div");
		div_text.setAttribute("class", "notification-text");
		const iconImg = `<img src="${base64icon}">`
		if ( isHtml ){
			div_text.innerHTML = `${iconImg}${text}`;
		} else {
			div_text.innerHTML = iconImg;
			div_text.innerText = text;
			// handle bold
			div_text.innerHTML = div_text.innerHTML.replace(/__/, "<strong>").replace(/__/, "</strong>");
		}


		const close = document.createElement("button");
		close.setAttribute("class", "notification-close");
		close.innerText = "X";
		close.addEventListener("click", () => {closeNotification(n_div)});


		
		n_div.appendChild(div_text);
		n_div.appendChild(close);

		document.querySelector("#notifications-container").appendChild(n_div)

		if ( timeout ){
			setTimeout(() => closeNotification(n_div), timeout);
		}
		return n_div;
	} catch ( err ) {
		window.alert(`${text}\n\n\n${err}`)
	}
}

function closeNotification(notificationDiv){
	notificationDiv.classList.add("hidden");
	setTimeout(() => notificationDiv.remove(), 800)
}

function handleExistingNotifications(text, type, isHtml){
	try {
		document.querySelectorAll(".notification-container").forEach((e) => {
			if ( e.classList.contains(`notification-${type}`) && (e.childNodes[0].innerText === text || e.childNodes[0].innerHTML === text ) ) {
				e.remove();
			} 
		})
	} catch (err) {
		console.error(isHtml, err);
	}
}

function closeAllNotifications(){
	document.querySelectorAll(".notification-container").forEach((e) => {closeNotification(e)})
}
function informError(notificationText, error, type="error"){
	console.error(notificationText, error);
	createNotification(notificationText, type, notificationTimeoutLong);
}

function createInsertLinkModal(){
	if ( document.querySelector(".insert-link-modal") ) { closeInsertLinkModal();return }
	const c_div = document.createElement("div");
	c_div.setAttribute("class","insert-link-modal");
	try {
		c_div.innerHTML = `
		<div class="insert-link-form">
			<label for='link-name'>Link Text</label>
			<input id='link-name' type='text' value="${caretPosition.cloneContents().textContent}">
			<label for='link-href'>Link url</label>
			<input id='link-href' type='text'>
		</div>
		`
	} catch ( err ) {
		informError("First, point where the link shuold be inserted", err, "warning")
		return
	}
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
	injectIntoDocument(html, true);
}

function injectIntoDocument(content, isHtml, injectCheckbox=false){
	if ( caretPosition ) {
		try { 
			let newNode = null;
			let additionalNode = null;
			if ( isHtml ){
				newNode = document.createElement("span");
				newNode.innerHTML = content;
				if ( injectCheckbox ) {
					newNode = document.createElement("input");
					let checkboxId = assignUniqueId('checkbox');
					newNode.id = checkboxId;
					newNode.setAttribute("onclick",`assignCheckboxValue('${checkboxId}')`);
					newNode.setAttribute("type", "checkbox");
					const additionalNodeId = assignUniqueId('span', "checkbox");
					additionalNode = document.createElement('span');
					additionalNode.innerText = "  ";
					additionalNode.setAttribute("contenteditable","true");
					additionalNode.setAttribute("id", additionalNodeId);
				}
				caretPosition.deleteContents(); // delete selected text if it's selected
			} else {
				newNode = document.createTextNode(content);
			}
			// if injecting with Enter
			if ( injectCheckbox ){
				caretPosition.commonAncestorContainer.parentNode.appendChild(newNode);
				// this way it works better on mobiles
				caretPosition.commonAncestorContainer.parentNode.appendChild(additionalNode);
				return caretPosition.commonAncestorContainer.parentNode
			} else {
				caretPosition.insertNode(newNode);
			}
		} catch ( err ) {
			informError("Cannot perform action!", err)
		}
	} else {
		let newNode = null;
		if ( isHtml ){
			newNode = document.createElement("div");
			newNode.innerHTML = content;
		} else {
			newNode = document.createTextNode(content);
		}
		document.querySelector("#editor").appendChild(newNode)
	}
	updateCaretPosition();
}
function updateCaretPosition(){
	selection = window.getSelection();
	if ( selection.rangeCount > 0 ) {
		caretPosition = selection.getRangeAt(0);
	}
}

function countWords() {
  	docTextAsArray = getDocumentText(false).trim().split(/\s+/);
	if ( docTextAsArray.length === 1 && !docTextAsArray[0]){
		return 0
	}
	return docTextAsArray.length
}

function saveSetting(key, value){
	if ( !validateUserConsent() ) { return }
	localStorage.setItem(key, value);
}

function adjustSelectionRange(n) {
    const selectionThis = window.getSelection();
    if (!selection.rangeCount) {
        console.warn("No selection found.");
        return;
    }

    const range = selectionThis.getRangeAt(0); // Get the current range
    const newStart = range.startOffset + n;
    const newEnd = range.endOffset + n;

    // Ensure the new range stays within the bounds of the selected node's text
    const textContent = range.startContainer.textContent;
    if (newStart < 0 || newEnd > textContent.length) {
        console.warn("New range exceeds text bounds.");
        return;
    }

    // Update the range
    range.setStart(range.startContainer, newStart);
    range.setEnd(range.endContainer, newEnd);

    // Apply the updated range to the selection
    selectionThis.removeAllRanges();
    selectionThis.addRange(range);
}

function changeTabBehavior(e){
	if ( e.key === "Tab" ){
		e.preventDefault();
		insertTab();
    }
}

function insertTab(){
	// delete selection
    caretPosition.deleteContents();
	
	// create text node for indent
    const tabNode = document.createTextNode(" ".repeat(indentSize));
	caretPosition.insertNode(tabNode);

	// move the caret
	caretPosition.setStartAfter(tabNode);
	caretPosition.setEndAfter(tabNode);
	selection.removeAllRanges();
	selection.addRange(caretPosition);
}

function copyMarkdown(){
	navigator.clipboard.writeText(
		getContentAsMarkdown()
	);
}

function userConsentModal(){
	if ( userConsent == 1) { return }
	createOverlay();
	const html = `
	<div>
	Do you agree to:
	<ul>
		<li>Storing some cookies on your browser</li>
		<li>Storing documents you have created in LocalStorage</li>
	</ul>
	<div class="modal-bottom">
		<div class="double-buttons">
			<button onclick="setUserConsent(1)">Yes</button>
			<button onclick="setUserConsent(0)">No</button>
		</div>
		If you won't agree, this will be displayed at every visit and core app functionalities such as document saving won't work.
		<br>
		<hr>
		<br>
		<strong>If you have some data already written, agree, <br>then save documents / enable AutoSave feature</strong>
	</div>
	</div>
	`
	createModal("Do you agree to cookies and storing data in LocalStorage?", html)
}

function setUserConsent(value, reloadAfter=false){
	if ( value == 1 ){
		userConsent = 1
		localStorage.setItem(userConsentKey, value);
		closeAllModals("Login");
		if ( reloadAfter ) {
			window.location.reload()
		}
	} else {
		userConsent = 0;
		closeAllModals();
	}
}

function validateUserConsent(showMessage=true){
	if ( userConsent == 1 ){
		return true
	} else if ( showMessage ) {
		const html = `
			<span>For this action, you need to consent to store data!</span>
			<button onclick="userConsentModal()">Change Settings</button>
		`
		createNotification(html, "warning", notificationTimeoutLong, true)
	}
	return false
}

function updateTitle(){
	// updates title due with document name
	const docName = getDocumentName();
	let newName = new String();
	if  ( docName ) {
		newName = docName + " - " + baseTitle;
	} else {
		newName = baseTitle;
	}
	document.title = newName;
}

function loadBackup(){
	const inp = document.createElement("input");
	inp.type = "file";
	inp.setAttribute("accept", ".writejs");

	inp.addEventListener("change", (e) => {
		const reader = new FileReader();
		const file = e.target.files[0];
		if ( file ) {
			reader.readAsText(file)
			reader.onload = ( () => {
				if ( showConfirm(`Do you want to REPLACE your notebook with ${file.name}`) ) {
					const obj = `${reader.result}`;
					loadNotebookFromJson(obj,false)
				}
			})
		}
	})

	document.body.appendChild(inp);
	inp.click();
	document.body.removeChild(inp);

}
function saveBackup(){
	try {
		const data = JSON.stringify(getAllLocalStorageItems());
		const compressedData = compressObject(data);
		const blob = new Blob([compressedData], { type: "writejs"});
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		link.download = "writejs_backup.writejs";
		link.click();
		createNotification("Backup 'writejs_backup.writejs' has been created!<br>To laod it use console and function <b>loadDataFromLocalStorageJson(backupAsString)</b>", "info", notificationTimeoutLong, true);
	} catch ( err ) {
		informError("Cannot save backup!", err)
	}

}

function assignUniqueId(elementType, prefix=null){
	if ( elementType === "checkbox" ){
		return `editor-checkbox-${document.querySelectorAll('#editor input[type="checkbox"]').length + 1}`
	} else {
		let prefixText = ""
		if ( prefix ) { 
			prefixText = `${prefix}-`; 
			return `editor-${prefix}${elementType}-${document.querySelectorAll(`#editor ${elementType}`).length + 1}`
		}
	}
}


function assignCheckboxValue(checkboxId){
	const element = document.getElementById(checkboxId)
	element.checked ? element.setAttribute("checked", "") : element.removeAttribute("checked");
	performAutoSave();
}
function insertCheckbox(fromEnter=false){
	// notify user that it is in development phase for mobiles
	if ( isLowWidthViewport && !fromEnter ){ createNotification("Checkboxes are not working well on mobiles", "warning") }
	const checkboxID = assignUniqueId("checkbox");
	const spanId = assignUniqueId("span", "checkbox");
	//updateCaretPosition();
	requestAnimationFrame(() => {
		if ( isLowWidthViewport ) { injectIntoDocument(softReturnText, false);}
	})
	nodeElement = injectIntoDocument(`<input id="${checkboxID}" onclick="assignCheckboxValue('${checkboxID}')" type="checkbox"><span id="${spanId}" contenteditable="true">  </span>`, true, fromEnter) // this span with 2 spaces is for mobile purposes 
	//updateCaretPosition();
	requestAnimationFrame(() => {
		if ( isLowWidthViewport){
			setTimeout( () => {
				moveCaretToEndById(spanId)
				focusEditor();
			
			}, 1
			)
		} else {
			moveCaretToEndById(spanId)
			focusEditor()
		}
	})

	return nodeElement
}
function handleCheckboxEnter(e){
	if ( e.key === "Enter"){
		// handle actions with caret:
		const parentElement = caretPosition.commonAncestorContainer.parentElement;
		if ( parentElement.id.startsWith("editor-checkboxspan") ) {
			if ( parentElement.innerText.trim() ){
				const nodeEl = insertCheckbox(true)
				const idToFocus = nodeEl.childNodes[2].id
				requestAnimationFrame(() => {
					moveCaretToEndById(idToFocus)
				})
			} else if ( false && !isLowWidthViewport ) { // due to other issues, it is disabled on mobile, apparently it may remove whole document for dekstops as well xD
				caretPosition.commonAncestorContainer.parentNode.parentNode.parentNode.parentNode.parentNode.remove() // if you remove one parentNode, then there will be more space
			} 
		}
	}
}
function simulateKeyPress(key, code, keyCode, which, howManyTimes=1) {
	console.warn("doenst work in contenteditable")
	for ( let i=0; i < howManyTimes; i++){
    	const event = new KeyboardEvent('keydown', {
    	    key: key,
    	    code: code,
    	    keyCode: keyCode,
    	    which: which,
    	    bubbles: true,
    	    cancelable: true
    	});
		caretPosition.commonAncestorContainer.parentNode.dispatchEvent(event)
	}

}


function moveCaretToNextElement() {
	locator = 'span, input, button, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'
	locator = 'span, div,input, button, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'
    const focusableElements = Array.from(
        document.querySelectorAll(locator)
    ).filter(el => !el.disabled && el.offsetParent !== null); // Exclude disabled/hidden elements

    const currentIndex = focusableElements.indexOf(document.activeElement);
    if (currentIndex !== -1 && currentIndex < focusableElements.length - 1) {
		const newEl = focusableElements[currentIndex + 1]
		newEl.focus()
    } 
}

function moveCaretToEndById(elementId) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element with ID "${elementId}" not found.`);
        return;
    }
    
    element.focus(); // Focus the element
    
    if (window.getSelection && document.createRange) {
        range = caretPosition
        selection = window.getSelection();
        
        range.selectNodeContents(element);
        range.collapse(false); // Move to end
        
        selection.removeAllRanges();
        selection.addRange(range);
    } else if (document.selection && document.body.createTextRange) { // For older IE
        const range = document.body.createTextRange();
        range.moveToElementText(element);
        range.collapse(false);
        range.select();
    }
}



async function sendLoginRequest(){
	try {
		const loginEl = document.getElementById("account-login");
		const passwEl = document.getElementById("account-password");
		const payload = {
			"username": loginEl.value,
			"password": passwEl.value
		}
		const resp = fetch(url + "/api/auth/login/submit", {
			"method": "POST",
			"headers": {"Content-Type": "application/x-www-form-urlencoded"},
			"body": new URLSearchParams(payload)
		})
		const respTest = await resp.json()
	} catch ( err ) {
		informError("Cannot login!", err);
	}
}

function compressObject(input) {
    const compressed = pako.deflate(input);  // Get Uint8Array
    const b64 = btoa(String.fromCharCode(...compressed)); // Convert to Base64
	return b64.replace(/\//g,"_").replace(/\+/g,"-");
}

function decompressObject(compressed) {
	const b64 = compressed.replace(/-/g, "+").replace(/_/g, "/");
    const binaryString = atob(b64); // Decode Base64
    const byteArray = Uint8Array.from(binaryString, c => c.charCodeAt(0)); // Convert to Uint8Array
    return pako.inflate(byteArray, { to: 'string' }); // Decompress
}

function handleQueries(){
	const params = new URLSearchParams(window.location.search);
	if (params.get("status") === "success"){
		const text = "Congratulations!"
			+ "You can login as "
			+ `${params.get('username')}`;
		createNotification(text, "info");
		removeParams('status', 'username');
	} else if ( params.get("msg") === "loginsuccess" ){
		createNotification("You logged in.", "info", notificationTimeoutLong);
		removeParams('msg');
		if ( typeof firstLoginOnDevice !== 'undefined'){
			setTimeout(firstLoginOnDevice, 500);
		}
	} else if ( params.get("status") === "unknownfailure" ){
		const text = "Unfortunately there were some unexpeted error!"
		createNotification(text, "error")
		removeParams('status');
	} else if ( params.get("logout")) {
		if ( typeof createAccountLoginModal !== 'undefined') {
			if ( params.get("logout") === "p" ) {
				createNotification(`You have been logged out.`, 'info');
			} else if ( params.get("logout") === "o" ) {
				createLoginExpiredNotification();
			} else if ( params.get("logout") === "i" ) {
				createAccountDeletedNotification();
			} else {
				const tempUserConsent = userConsent
				purgeLocalStorage(false);
				const logoutOption = params.get("logout");
				setUserConsent(tempUserConsent, false);
				removeParams('logout');
				const postLogoutA = document.createElement("a");
				postLogoutA.href="?logout=" + (logoutOption === "3" ? "o" : logoutOption === "4" ? "i" : "p"); // 3 is in case of 401, 4 is in case of delete, remaining ones are casual loggout
				document.body.appendChild(postLogoutA);
				postLogoutA.click();
				setUserLoggedIn(false);
			}
		} else {
			console.warn('logout param for authenticated user:','params logout', params.get("logout"))
			//createNotification(`Have someone tried to log you out?\nPlease be safe!`, "warning", null)  // this is commented as it looks that browser can add some shady params during reload
		}
		removeParams('logout');
	} else if ( newPass = params?.get("newpassword") ) {
		createNotification(`Your new password is __${newPass}__\nChange it immedeitaly after login!`, "info", null)
		removeParams('newpassword');
	} else if ( params.get("passwordresetsent") ) {
		createNotification(`Password reset mail has been sent!`, 'info');
		removeParams('passwordresetsent');
	} else if ( params.get("status") === "failure" ){
		for ( let key of params.keys()){
			removeParams('status');
			if ( key === "status" ) { continue } 
			switch ( key ) {
				case "password":
					createNotification(`<p><strong>Password</strong> has to be:</p>
						<ul>
						<li>at least 6 characters long</li>
						<li>at max 32 characters longlong</li>
						</ul>`, "error", notificationTimeoutLong, true)
					removeParams('password');
					break;
				case "email":
					createNotification(`This <strong>Email</strong> is already taken`, "error", notificationTimeoutLong, true)
					removeParams('email');
					break
				case "username":
					createNotification(`This <strong>Username</strong> is already taken`, "error", notificationTimeoutLong, true)
					removeParams('username');
					break
				case "message":
					if ( params.get(key) === "invalidpassword" ){
						createNotification(`Invalid Password for user __${params.get('login')}__`, "error", notificationTimeoutLong)
						removeParams('message', 'login');
						return
					} else if ( params.get(key) === 'forgotpassworderror' ){
						createNotification(`Cannot perform password reset!\nIf you wanted to reset your password, do it again`, "error", notificationTimeoutLong)
						removeParams('message');
						return
					} else if ( params.get(key) === "invaliduseroremail" ){
						createAccountLoginModal()
						createNotification(`Cannot login with this login! Try again!`, "error", null, false)
						removeParams('message');
						return
					} else if ( params.get(key) === "userisblocked"){
						createNotification(`Please wait 15 minutes and try again.`, 'error', null, false);
						removeParams('message');
						removeParams('login');
						removeParams("status");
						return
					}
					createNotification(`There was some other issue, sorry!`, 'error', notificationTimeoutLong)
					removeParams('message');
				default:
					createNotification(`There was some other issue, sorry!`, 'error', notificationTimeoutLong)
					removeParams("status");
					break;
			}
		}
	}
}

function removeParams(...params) {
	for ( let paramName of params ){
    	let searchParams = new URLSearchParams(window.location.search);
    	searchParams.delete(paramName);
    	if (history.replaceState) {
    	    let searchString = searchParams.toString().length > 0 ? '?' + searchParams.toString() : '';
    	    let newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname +  searchString + window.location.hash;
    	    history.replaceState(null, '', newUrl);
    	}
	}
}

function setEventForFilteringChildrenNodes(relatedInput, baseElQuerySelector, clearButtonQuerySelector=null){
	const inpu = document.querySelector(relatedInput);
	const elements = document.querySelectorAll(`${baseElQuerySelector}`)
	if ( clearButtonQuerySelector ){
		document.querySelector(clearButtonQuerySelector).addEventListener("click", () => {inpu.value = "";elements.forEach((e)=>{e.classList.remove("burried")})})
	}
	inpu.addEventListener("input",() =>{
			elements.forEach((e) => {
			const searchEl = e.childNodes[0]
			const reg = new RegExp(inpu.value, "i");
			if ( !searchEl.innerText.match(reg) ) { e.classList.add("burried") }
			else {e.classList.remove("burried") }
		})
	})
}

function getUserLoggedIn(){
	const val = localStorage.getItem(userLoggedInKey);
	return val === "1" ? true : val === "0" ? false : null
}

function setUserLoggedIn(state){
	"set true, false or null"
	const stateAsStr = state === true ? "1" : state === false ? "0" : "null";
	userLoggedIn = state;
	localStorage.setItem(userLoggedInKey, stateAsStr)
}

function createLoginExpiredNotification(){
	setTimeout( () => {
		createNotification(`Your session has expired! <br><button onclick='createAccountLoginModal()'>Login again</button>`, 'error', null, true);
		setUserConsent(userConsent);
	}, 100);
}


function createAccountDeletedNotification(){
	setTimeout( () => {
		createNotification(`Your account is deleted.<br><button onclick="createRegisterModal()">You can create a new account</button>`, 'error', null, true);
		setUserConsent(userConsent);
	}, 100);
}

function countDocuments(){
	let count = 0;
	for ( let e of Object.entries(localStorage)){
		if ( e.startsWith(docPrefix)){
			count ++;
		}
	}
	return count;
}

function loadNotebookFromJson(json, excludeCurrentDocument=true, loadLastOpened=true){
	jsonObject = decompressObject(json);
	loadDataFromLocalStorageJson(jsonObject, excludeCurrentDocument, loadLastOpened);
	if (loadLastOpened){
		loadLastOpenedDocument(excludeCurrentDocument, loadLastOpened);
	}
}

function createFlashcardByQuerySelector(selector, text1="key",text2="value"){
	const e = document.createElement("div");
	e.classList.add("flashcard");
	e.innerHTML = `<flashcard><key class='key'>${text1}</key><value class='val'>${text2}</value></flashcard>
	`
	document.querySelector(selector).appendChild(e)
}

function createInsertHtmlModal(){
	const html = `
	<h1>Insert HTML into textarea below:</h1>
	<div class="form-div">
	<textarea id="htmltobeappended" style="width:100%;height: 40vh;"></textarea>
	<hr>
	<button id="insertinto-html">Replace current document with provided HTML</button>
	<button id="append-html">Append HTML into document</button>
	</div>
	`
	createModal("Insert HTML", html);
	document.getElementById("insertinto-html").addEventListener("click",() => { fillEditorWithHTML(document.getElementById(`htmltobeappended`).value, false);closeAllModals() })
	document.getElementById("append-html").addEventListener("click",() => { fillEditorWithHTML(document.getElementById(`htmltobeappended`).value, true) ; closeAllModals()})
}



function createInsertMarkdownModal(){
	const html = `
	<h1>Insert Markdown into textarea below:</h1>
	<div class="form-div">
	<textarea id="markdowntobeappended" style="width:100%;height: 40vh;"></textarea>
	<hr>
	<button id="insertinto-markdown">Replace current document with provided Markdown</button>
	<button id="append-markdown">Append Markdown into document</button>
	</div>
	`
	createModal("Insert Markdown", html);
	document.getElementById("insertinto-markdown").addEventListener("click",() => { 
		const generatedHtml = markdownToHtml(document.getElementById(`markdowntobeappended`).value);
		fillEditorWithHTML(generatedHtml, false);
		closeAllModals() 
	})
	document.getElementById("append-markdown").addEventListener("click",() => { 
		const generatedHtml = markdownToHtml(document.getElementById(`markdowntobeappended`).value);
		fillEditorWithHTML(generatedHtml, true);
		closeAllModals()
	})
}
