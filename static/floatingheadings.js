/*
 * Floating headings: at the top of each editor, the headings of the section being read stay in sight while the document
 * scrolls under them (like sticky scroll in VS Code); a click on one goes to it (goToHeading, toc.js).
 * Settings > Floating headings: off, all the headings of the section (the chain from the highest level to the lowest),
 * only the highest level one or only the lowest level one. It goes with the notebook, but is picked apart for phones,
 * tablets and desktops (floatingHeadingsKey: {mobile, tablet, desktop}).
 * In focus mode the document's name floats above them, unless Settings > Focus mode > Floating title is off
 * (focusTitleKey); not while the document's own title (line 0, workspace.js) is in sight.
 */
const floatingHeadingsKey = "__floatingHeadings__"; // {mobile, tablet, desktop}: "off" / "all" / "highest" / "lowest", goes with the notebook
const focusTitleKey = "__focusTitle__"; // "0" when the document's name doesn't float in focus mode, goes with the notebook
const floatingHeadingsModes = [
	{ value: "off", label: "Off" },
	{ value: "all", label: "All headings" },
	{ value: "highest", label: "Only highest level heading" },
	{ value: "lowest", label: "Only lowest level heading" },
];
const floatingDevices = [
	{ key: "mobile", label: "Phone" },
	{ key: "tablet", label: "Tablet" },
	{ key: "desktop", label: "Desktop" },
];
let floatingFrame = 0;

function floatingDevice(){
	// the same widths as the rest of the app: under 600px a phone, under 1000px a tablet
	const width = window.innerWidth;
	return width < 600 ? "mobile" : width < 1000 ? "tablet" : "desktop";
}

function readFloatingHeadings(){
	const saved = readJsonSetting(floatingHeadingsKey);
	const valid = (mode) => floatingHeadingsModes.some(m => m.value === mode) ? mode : "off";
	return Object.fromEntries(floatingDevices.map(d => [d.key, valid(saved[d.key])]));
}

function floatingHeadingsMode(){
	return readFloatingHeadings()[floatingDevice()];
}

function focusTitleFloats(){
	// on until turned off
	return localStorage.getItem(focusTitleKey) !== "0";
}

function scheduleFloatingHeadings(){
	if ( floatingFrame ) { return }
	floatingFrame = requestAnimationFrame(() => {
		floatingFrame = 0;
		panes.forEach(renderFloatingHeadings);
	});
}

function sectionHeadings(editor, top){
	// the headings of the section at the top of the view: the last one of each level above it, highest level first
	const chain = [];
	for ( const heading of editor.querySelectorAll("h1, h2, h3, h4") ) {
		const rect = heading.getBoundingClientRect();
		if ( !rect.height ) { continue } // folded away (folding.js)
		if ( rect.top >= top ) { break }
		const level = Number(heading.nodeName[1]);
		while ( chain.length && Number(chain.at(-1).nodeName[1]) >= level ) { chain.pop() }
		chain.push(heading);
	}
	return chain;
}

function renderFloatingHeadings(pane){
	const bar = pane.el.querySelector(".floating-headings");
	const scroller = pane.el.querySelector(".pane-scroll");
	if ( !bar || !scroller ) { return }
	const mode = floatingHeadingsMode();
	const tab = tabById(pane.tabId);
	// the document's own title out of sight (or not shown): its name floats in focus mode
	const titleShown = !pane.title.hidden && pane.title.getBoundingClientRect().bottom > scroller.getBoundingClientRect().top;
	const withTitle = document.body.classList.contains("focus-mode") && focusTitleFloats() && !titleShown && Boolean(tab);
	const name = withTitle ? tabLabel(tab) : null;
	// what is under the bar counts as scrolled past: the headings are looked for again under the bar they make, until it
	// stays the same
	const top = scroller.getBoundingClientRect().top + 1;
	let covered = bar.hidden ? 0 : bar.firstElementChild?.offsetHeight || 0;
	for ( let pass = 0; pass < 3; pass++ ) {
		const headings = floatingHeadingsAt(pane, mode, top + covered);
		showFloatingHeadings(pane, bar, scroller, mode, name, headings);
		const height = bar.hidden ? 0 : bar.firstElementChild.offsetHeight;
		if ( height === covered ) { break }
		covered = height;
	}
}

function floatingHeadingsAt(pane, mode, top){
	if ( mode === "off" || !pane.el.querySelector(".pane-scroll").scrollTop ) { return [] }
	const headings = sectionHeadings(pane.editor, top);
	if ( mode === "highest" ) { return headings.slice(0, 1) }
	if ( mode === "lowest" ) { return headings.slice(-1) }
	return headings;
}

function showFloatingHeadings(pane, bar, scroller, mode, name, headings){
	// rebuilt only when what it shows changed, not on every scrolled pixel
	const signature = JSON.stringify([name, headings.map(h => h.nodeName + tocEntryText(h))]);
	if ( bar.dataset.signature === signature && pane.floatingHeadings?.every((h, i) => h === headings[i]) ) { return }
	bar.dataset.signature = signature;
	pane.floatingHeadings = headings;
	const inner = document.createElement("div");
	inner.className = "floating-headings-inner";
	if ( name !== null ) {
		const title = document.createElement("div");
		title.className = "floating-title";
		title.textContent = name;
		inner.append(title);
	}
	const highest = Math.min(...headings.map(h => Number(h.nodeName[1])));
	for ( const heading of headings ) {
		const row = document.createElement("button");
		row.type = "button";
		row.className = "floating-heading";
		row.dataset.level = heading.nodeName[1];
		// all of them: indented like the table of contents
		row.style.setProperty("--depth", mode === "all" ? Number(heading.nodeName[1]) - highest : 0);
		row.textContent = tocEntryText(heading) || "Untitled heading";
		row.title = "Go to the heading";
		row.addEventListener("click", () => { if ( heading.isConnected ) { focusPane(pane); goToHeading(heading) } });
		inner.append(row);
	}
	bar.replaceChildren(inner);
	bar.hidden = !inner.children.length;
	// what the caret or a search scrolls to isn't put under the bar
	scroller.style.setProperty("--floating-height", bar.hidden ? "0px" : inner.offsetHeight + "px");
}


// Settings
function floatingHeadingsSettingsHtml(){
	// goes in the Headings section of Settings (createSettingsModal, script.js): a row for each kind of screen
	const modes = readFloatingHeadings();
	const current = floatingDevice();
	return `
		<div class="floating-setting" role="group" aria-label="Floating headings">
			<span class="floating-setting-title">Floating headings</span>
			${floatingDevices.map(d => `
			<div class="floating-setting-row" role="radiogroup" aria-label="Floating headings on ${d.label.toLowerCase()}s">
				<span class="floating-setting-device${d.key === current ? " current" : ""}"${d.key === current ? ' title="This screen"' : ""}>${d.label}</span>
				${floatingHeadingsModes.map(m => `<label class="check"><input type="radio" name="setting-floating-${d.key}" value="${m.value}"${modes[d.key] === m.value ? " checked" : ""}>${m.label}</label>`).join("")}
			</div>`).join("")}
		</div>
		<p class="muted small">The headings of the section you are in stay at the top of the editor while it scrolls; a click goes to one. Picked apart for each kind of screen, the bold one is this one.</p>`;
}

function focusTitleSettingsHtml(){
	return `<label class="check"><input id="setting-focus-title" type="checkbox"${focusTitleFloats() ? " checked" : ""}>Floating title</label>
		<p class="muted small">The document's name stays at the top in focus mode.</p>`;
}

function initFloatingHeadingsSettings(){
	for ( const device of floatingDevices ) {
		document.querySelectorAll(`input[name="setting-floating-${device.key}"]`).forEach((input) => input.addEventListener("change", (e) => {
			if ( !validateUserConsent() ) { e.target.checked = false; return }
			const modes = readFloatingHeadings();
			modes[device.key] = e.target.value;
			localStorage.setItem(floatingHeadingsKey, JSON.stringify(modes));
			scheduleFloatingHeadings();
			if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
		}));
	}
	document.getElementById("setting-focus-title")?.addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = !e.target.checked; return }
		localStorage.setItem(focusTitleKey, e.target.checked ? "1" : "0");
		scheduleFloatingHeadings();
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	});
}


// the headings follow the scroll, edits, other documents opened, focus mode and the screen's width
document.addEventListener("scroll", (e) => { if ( e.target.classList?.contains("pane-scroll") ) { scheduleFloatingHeadings() } }, true);
new MutationObserver(scheduleFloatingHeadings).observe(document.getElementById("editor-grid"),
	{ childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "hidden", "data-collapsed"] });
new MutationObserver(scheduleFloatingHeadings).observe(document.body, { attributes: true, attributeFilter: ["class"] });
window.addEventListener("resize", scheduleFloatingHeadings);
window.addEventListener("storage", (e) => { if ( e.key === floatingHeadingsKey || e.key === focusTitleKey ) { scheduleFloatingHeadings() } });
scheduleFloatingHeadings();
