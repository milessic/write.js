/*
 * Tables: inserted from the toolbar ("Table": columns, rows and whether the first row is the headers), changed from
 * the right-click menu of a cell, or the toolbar's "Table" with the caret in one: rows and columns added or removed,
 * the table removed. Shift+right-click keeps the browser's own menu.
 * A table is always <table>[<thead><tr><th>…]<tbody><tr><td>…</table>, cells of text and simple formatting, no
 * attributes; pasted HTML and Markdown tables come in like that too. A change rebuilds the table and puts it in place
 * with insertHTML, so Ctrl/Cmd+Z undoes it. Tab / Shift+Tab move between the cells, Tab in the last one adds a row.
 * Cells are selected like in a spreadsheet: a selection from one cell to another (a drag, Shift+click, Shift+arrows) is
 * the rectangle between them, Ctrl+click (Cmd+click on Apple devices) adds or removes a cell. Copying selected cells, or
 * a selection with tables in it, puts Markdown or HTML in the clipboard's text (Settings), and the table in its HTML.
 * Cmd+Ctrl+Up/Down (or k/j) moves the caret's row, or the selected ones, above / below the next row, as for checklists.
 */
const tableMaxColumns = 50;
const tableMaxRows = 500;
const tableCellSelector = ".editor td, .editor th";
// what a pasted table never brings as text
const tableSkippedTags = new Set(["STYLE", "SCRIPT", "META", "TITLE", "HEAD", "LINK", "COLGROUP", "COL", "TEMPLATE", "CAPTION"]);
const tableLineTags = new Set(["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE", "UL", "OL", "SECTION", "ARTICLE", "TR"]);
const markdownTableSeparator = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// a table as {head: [cell html] | null, body: [[cell html]]}, every row as long as the longest
function tableModel(table, safe=false){
	const rows = [...table.rows].filter((tr) => tr.closest("table") === table);
	const cellsOf = (tr) => [...tr.cells].flatMap((cell) => {
		const span = Math.min(Math.max(parseInt(cell.getAttribute("colspan")) || 1, 1), tableMaxColumns);
		return [safe ? tableCellHtml(cell) : cell.innerHTML, ...Array(span - 1).fill("")];
	});
	const first = rows[0];
	const hasHead = Boolean(first) && (first.parentElement.nodeName === "THEAD" || [...first.cells].every((cell) => cell.nodeName === "TH"));
	const grid = rows.map(cellsOf);
	const columns = Math.min(Math.max(1, ...grid.map((row) => row.length)), tableMaxColumns);
	const fit = (row) => [...row.slice(0, columns), ...Array(Math.max(0, columns - row.length)).fill("")];
	return { head: hasHead ? fit(grid[0]) : null, body: grid.slice(hasHead ? 1 : 0).map(fit) };
}

function tableHtml(model){
	const cell = (tag, html) => `<${tag}>${isBlankCell(html) ? "<br>" : html}</${tag}>`;
	const head = model.head ? `<thead><tr>${model.head.map((html) => cell("th", html)).join("")}</tr></thead>` : "";
	return `<table>${head}<tbody>${model.body.map((row) => `<tr>${row.map((html) => cell("td", html)).join("")}</tr>`).join("")}</tbody></table>`;
}

function isBlankCell(html){
	return !html || /^(\s|<br>)*$/.test(html);
}

function tableCellHtml(cell){
	// a pasted cell's text and simple formatting (script.js), its lines (paragraphs, <br>s) kept apart by <br>s
	const lines = [""];
	const walk = (node) => {
		for ( const child of node.childNodes ) {
			if ( child.nodeName === "BR" ) { lines.push(""); continue }
			if ( tableSkippedTags.has(child.nodeName) ) { continue }
			if ( child.nodeType === Node.ELEMENT_NODE && (tableLineTags.has(child.nodeName) || child.nodeName === "TABLE") ) {
				if ( lines.at(-1).trim() ) { lines.push("") }
				walk(child);
				if ( lines.at(-1).trim() ) { lines.push("") }
				continue
			}
			lines[lines.length - 1] += safeInlineHtml(child);
		}
	};
	walk(cell);
	const kept = lines.map((line) => line.trim());
	while ( kept.length && !kept.at(-1) ) { kept.pop() }
	while ( kept.length && !kept[0] ) { kept.shift() }
	// <b>/<i> as typed (sanitizedRenames, script.js)
	return kept.join("<br>").replace(/<(\/?)strong>/g, "<$1b>").replace(/<(\/?)em>/g, "<$1i>");
}

function normalizedTableHtml(table){
	// an imported or pasted table as the editor makes it; an empty header row (Markdown needs one, the export writes
	// it for a table without headers) goes
	const model = tableModel(table, true);
	if ( model.head && model.head.every(isBlankCell) && model.body.length ) { model.head = null }
	return tableHtml(model);
}

function cellOf(node){
	const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
	const cell = el?.closest("td, th");
	return cell?.closest(".editor") ? cell : null;
}

function caretCell(){
	const selection = window.getSelection();
	const editor = document.getElementById("editor");
	if ( selection.rangeCount && editor.contains(selection.anchorNode) ) { return cellOf(selection.anchorNode) }
	if ( lastEditorRange && editor.contains(lastEditorRange.startContainer) ) { return cellOf(lastEditorRange.startContainer) }
	return null;
}

// the cell's place: its row counts the header row, if any
function cellPosition(cell){
	const table = cell.closest("table");
	const rows = [...table.rows].filter((tr) => tr.closest("table") === table);
	return { table, row: rows.indexOf(cell.parentElement), column: [...cell.parentElement.cells].indexOf(cell) };
}

function caretToCell(cell, atEnd=true){
	const range = document.createRange();
	range.selectNodeContents(cell);
	// an empty cell holds only its <br>: the caret goes before it
	if ( atEnd && cell.lastChild?.nodeName !== "BR" ) { range.collapse(false) } else { range.collapse(true) }
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	revealCell(cell);
}

function revealCell(cell){
	// a table wider than the editor scrolls sideways (styles.css): the cell with the caret is scrolled into it
	const table = cell?.closest("table");
	if ( !table || table.scrollWidth <= table.clientWidth ) { return }
	const box = table.getBoundingClientRect();
	const rect = cell.getBoundingClientRect();
	if ( rect.left < box.left ) { table.scrollLeft -= box.left - rect.left }
	else if ( rect.right > box.right ) { table.scrollLeft += rect.right - box.right }
}

function insertOverTable(table, html){
	// insertHTML over the table: one step of the browser's undo. Chrome moves what it inserts into what follows: an
	// empty line after the table would wrap it, a list after it take it in (or the empty line put there instead of
	// it). So a list right after it is replaced with it, as it is, and the line after them holds a zero-width space
	// while inserting
	const editor = table.closest(".editor");
	editor.focus({preventScroll: true});
	// Safari only edits a table laid out as one, not as the block that scrolls sideways (styles.css): laid out so
	// before the selection is made
	editor.classList.add("table-editing");
	void table.offsetWidth;
	const range = document.createRange();
	range.setStartBefore(table);
	let end = table;
	if ( table.nextElementSibling?.matches("ul, ol") ) {
		end = table.nextElementSibling;
		html += end.outerHTML;
	}
	range.setEndAfter(end);
	const next = end.nextElementSibling;
	const into = !next || next.nodeName === "HR" ? null
		: next.matches("ul, ol") ? next.querySelector("li") : next.nodeName === "TABLE" ? next.querySelector("td, th") : next;
	const hold = into ? into.insertBefore(document.createTextNode("\u200b"), into.firstChild) : null;
	const selection = window.getSelection();
	selection.removeAllRanges();
	selection.addRange(range);
	document.execCommand("insertHTML", false, html);
	editor.classList.remove("table-editing");
	hold?.remove();
}

function moveTablesOutOfLines(editor){
	// a table in a line (<div><table>…</table></div>) or in a cell of another table (both made by inserting over a
	// table before insertOverTable) goes up to the editor's lines, the inner table after the outer one. Only for a
	// loaded document, before any edit: nodes moved by hand would break the browser's undo
	for ( const table of [...editor.querySelectorAll("td table, th table")].reverse() ) {
		let outer = table.parentElement.closest("table");
		while ( outer.parentElement.closest("td, th") ) { outer = outer.parentElement.closest("table") }
		outer.after(table);
	}
	for ( const line of [...editor.children] ) {
		if ( line.nodeName === "DIV" && line.querySelector(":scope > table") ) { splitLineIntoBlocks(line) }
	}
}

function replaceTable(table, model, row, column){
	const editor = table.closest(".editor");
	const index = [...editor.querySelectorAll("table")].indexOf(table);
	insertOverTable(table, tableHtml(model));
	const replaced = editor.querySelectorAll("table")[index];
	if ( replaced ) {
		const rows = [...replaced.rows];
		const tr = rows[Math.max(0, Math.min(row, rows.length - 1))];
		caretToCell(tr.cells[Math.max(0, Math.min(column, tr.cells.length - 1))]);
	}
	updateCaretPosition();
	performAutoSave();
}

function changeTable(cell, change){
	// change(grid, row, column) edits grid.rows (the header row first, if grid.head) and returns where the caret
	// goes: [row, column]
	const { table, row, column } = cellPosition(cell);
	const model = tableModel(table);
	const grid = { head: Boolean(model.head), rows: model.head ? [model.head, ...model.body] : model.body };
	const [caretRow, caretColumn] = change(grid, row, column);
	replaceTable(table, { head: grid.head ? grid.rows[0] : null, body: grid.head ? grid.rows.slice(1) : grid.rows }, caretRow, caretColumn);
}

function addTableRows(cell, at, count){
	// count empty rows before the row at (the header row first, if any), the caret in the first of them
	changeTable(cell, (grid, row, column) => {
		grid.rows.splice(at, 0, ...Array.from({ length: count }, () => Array(grid.rows[0].length).fill("")));
		return [at, column];
	});
}

function removeTableRow(cell){
	changeTable(cell, (grid, row, column) => {
		grid.rows.splice(row, 1);
		if ( row === 0 ) { grid.head = false } // the header row went: the table has none
		return [Math.min(row, grid.rows.length - 1), column];
	});
}

function addTableColumns(cell, at, count){
	// count empty columns before the column at, the caret in the first of them
	changeTable(cell, (grid, row) => {
		for ( const cells of grid.rows ) { cells.splice(at, 0, ...Array(count).fill("")) }
		return [row, at];
	});
}

function removeTableColumn(cell){
	changeTable(cell, (grid, row, column) => {
		for ( const cells of grid.rows ) { cells.splice(column, 1) }
		return [row, Math.min(column, grid.rows[0].length - 1)];
	});
}

function addTableHeaderRow(cell){
	changeTable(cell, (grid, row, column) => {
		grid.rows.unshift(Array(grid.rows[0].length).fill(""));
		grid.head = true;
		return [0, column];
	});
}

function removeTable(table){
	// the table becomes an empty line, the caret on it
	const editor = table.closest(".editor");
	const before = table.previousElementSibling;
	const parent = table.parentNode;
	insertOverTable(table, "<div><br></div>");
	const line = before ? before.nextElementSibling : parent.firstElementChild;
	if ( line && editor.contains(line) ) { window.getSelection().collapse(line, 0) }
	updateCaretPosition();
	performAutoSave();
}

function tableMenuItems(cell){
	// with the cell in the selected ones, as many rows / columns are added as they span, around them
	const { table, row } = cellPosition(cell);
	const model = tableModel(table);
	const rowCount = model.body.length + (model.head ? 1 : 0);
	const inHead = Boolean(model.head) && row === 0;
	const places = tableSelection?.table === table && tableSelection.cells.has(cell) ? [...tableSelection.cells].filter((c) => c.isConnected).map(cellPosition) : [cellPosition(cell)];
	const rows = [...new Set(places.map((p) => p.row))];
	const columns = [...new Set(places.map((p) => p.column))];
	const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
	const top = Math.min(...rows);
	const left = Math.min(...columns);
	return [
		{ label: `Add ${plural(rows.length, "row")} above`, action: () => addTableRows(cell, top, rows.length), disabled: Boolean(model.head) && top === 0 },
		{ label: `Add ${plural(rows.length, "row")} below`, action: () => addTableRows(cell, Math.max(...rows) + 1, rows.length) },
		{ label: inHead ? "Remove header row" : "Remove row", action: () => removeTableRow(cell), disabled: rowCount < 2 },
		null,
		{ label: `Add ${plural(columns.length, "column")} left`, action: () => addTableColumns(cell, left, columns.length) },
		{ label: `Add ${plural(columns.length, "column")} right`, action: () => addTableColumns(cell, Math.max(...columns) + 1, columns.length) },
		{ label: "Remove column", action: () => removeTableColumn(cell), disabled: (model.head || model.body[0]).length < 2 },
		...(model.head ? [] : [null, { label: "Add header row", action: () => addTableHeaderRow(cell) }]),
		null,
		{ label: "Remove table", action: () => removeTable(table), danger: true },
	];
}

function openTableTool(){
	// the toolbar's "Table": with the caret in a table its menu, elsewhere the widget adding one
	const cell = caretCell();
	if ( !cell ) { createInsertTableModal(); return }
	const button = [document.getElementById("tb-btn-table"), document.querySelector("#tb-more-select .block-select-btn")]
		.find((el) => el?.offsetParent);
	const rect = button ? button.getBoundingClientRect() : cell.getBoundingClientRect();
	openContextMenu({ clientX: rect.left, clientY: rect.bottom + 2, defaultPrevented: false, preventDefault(){} }, tableMenuItems(cell));
}

function createInsertTableModal({ columns: columnCount = 3, rows: rowCount = 3, headers: withHeaders = true } = {}){
	const html = `
	<div class="stack insert-table">
		<label>Columns<input id="table-columns" type="number" min="1" max="${tableMaxColumns}" value="${columnCount}"></label>
		<label>Rows<input id="table-rows" type="number" min="1" max="${tableMaxRows}" value="${rowCount}"></label>
		<label class="row"><input id="table-headers" type="checkbox"${withHeaders ? " checked" : ""}> Add headers</label>
	</div>
	<div class="row">
		<button class="btn primary" id="insert-table-btn">Add</button>
		<button class="btn" id="cancel-table-btn">Cancel</button>
	</div>
	`
	createModal("Insert table", html);
	const columns = document.getElementById("table-columns");
	const add = () => {
		const count = (input, max) => Math.max(1, Math.min(parseInt(input.value) || 1, max));
		const cols = count(columns, tableMaxColumns);
		const rows = count(document.getElementById("table-rows"), tableMaxRows);
		const headers = document.getElementById("table-headers").checked;
		closeAllModals();
		insertTable(cols, rows, headers);
	};
	document.getElementById("insert-table-btn").addEventListener("click", add);
	document.getElementById("cancel-table-btn").addEventListener("click", () => { closeAllModals(); restoreEditorSelection() });
	document.querySelector(".insert-table").addEventListener("keydown", (e) => { if ( e.key === "Enter" ) { e.preventDefault(); add() } });
	columns.focus();
	columns.select();
}

function tableCommandOptions(args){
	// vi's :table [columns] [rows] [headers]: the widget's values, or the error; headers are true/false, yes/no, 1/0
	if ( args.length > 3 ) { return "E488: Trailing characters (:table columns rows headers)" }
	const options = {};
	for ( const [name, value, max] of [["columns", args[0], tableMaxColumns], ["rows", args[1], tableMaxRows]] ) {
		if ( value === undefined ) { continue }
		const count = /^\d+$/.test(value) ? parseInt(value) : 0;
		if ( count < 1 || count > max ) { return `E474: Invalid argument: ${value} (${name}: 1 to ${max})` }
		options[name] = count;
	}
	if ( args[2] !== undefined ) {
		if ( /^(true|yes|1)$/i.test(args[2]) ) { options.headers = true }
		else if ( /^(false|no|0)$/i.test(args[2]) ) { options.headers = false }
		else { return `E474: Invalid argument: ${args[2]} (headers: true / false, yes / no, 1 / 0)` }
	}
	return options;
}

function insertTable(columns, rows, headers){
	const empty = () => Array(columns).fill("");
	const model = { head: headers ? empty() : null, body: Array.from({ length: rows }, empty) };
	insertTablesHtml(tableHtml(model));
}

function caretOutOfBlocks(editor){
	// a table goes into a line, splitting it at the caret; in anything else (a list, a heading, a code block, another
	// table) it goes after it. No caret in the editor: at its end
	const selection = window.getSelection();
	if ( !selection.rangeCount || !editor.contains(selection.anchorNode) ) {
		const range = document.createRange();
		range.selectNodeContents(editor);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}
	let top = selection.anchorNode;
	while ( top && top.parentNode !== editor ) { top = top.parentNode }
	if ( !top || top.nodeName === "DIV" && !top.querySelector("table") ) { return }
	const range = document.createRange();
	range.setStartAfter(top);
	range.collapse(true);
	selection.removeAllRanges();
	selection.addRange(range);
}

function insertTablesHtml(html){
	// with the caret in the first cell of the first table inserted; lines around a table at the start or the end of
	// the document, so the caret can get above or under it
	restoreEditorSelection();
	const editor = document.getElementById("editor");
	editor.focus({preventScroll: true});
	caretOutOfBlocks(editor);
	const before = new Set(editor.querySelectorAll("table"));
	document.execCommand("insertHTML", false, html);
	moveLinesOutOfLines(editor);
	const added = [...editor.querySelectorAll("table")].filter((table) => !before.has(table));
	for ( const table of added ) {
		if ( table.parentElement !== editor ) { continue }
		if ( !table.nextElementSibling ) { table.after(emptyLine()) }
		if ( !table.previousElementSibling ) { table.before(emptyLine()) }
	}
	if ( added[0]?.rows[0]?.cells[0] ) { caretToCell(added[0].rows[0].cells[0]) }
	updateCaretPosition();
	performAutoSave();
	handleWordCounter();
}

// pasting: a table in the clipboard's HTML, or a Markdown table in its text, comes in as the editor's table
function pastedTablesFromHtml(html){
	// the HTML's tables, and its other lines as text and simple formatting; null without a table
	const doc = new DOMParser().parseFromString(html, "text/html");
	if ( !doc.body.querySelector("table") ) { return null }
	const parts = [];
	const walk = (node) => {
		for ( const child of node.childNodes ) {
			if ( tableSkippedTags.has(child.nodeName) ) { continue }
			if ( child.nodeName === "TABLE" ) { parts.push(normalizedTableHtml(child)); continue }
			if ( child.nodeType === Node.ELEMENT_NODE && (child.querySelector("table") || tableLineTags.has(child.nodeName) && child.querySelector([...tableLineTags].join(","))) ) {
				walk(child);
				continue
			}
			const line = safeInlineHtml(child).trim();
			if ( line ) { parts.push(`<div>${line}</div>`) }
		}
	};
	walk(doc.body);
	return parts.join("");
}

function widenMarkdownTableSeparators(markdown){
	// GFM's |-|:-:| rows, as showdown takes them: three dashes at least
	const lines = markdown.split("\n");
	return lines.map((line, i) => i && lines[i - 1].includes("|") && markdownTableSeparator.test(line) && line.includes("-")
		? line.replace(/-+/g, (dashes) => dashes.padEnd(3, "-")) : line).join("\n");
}

function pastedTablesFromMarkdown(text){
	// Markdown tables (a header row, a |---| row, rows) and the other lines as they are; null without a table
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const isRow = (line) => line?.includes("|") && line.trim() !== "";
	const parts = [];
	let found = false;
	for ( let i = 0; i < lines.length; i++ ) {
		if ( isRow(lines[i]) && markdownTableSeparator.test(lines[i + 1] || "") && lines[i + 1].includes("-") ) {
			let end = i + 2;
			while ( end < lines.length && isRow(lines[end]) ) { end++ }
			const converter = new showdown.Converter({ tables: true, noHeaderId: true });
			const template = document.createElement("template");
			template.innerHTML = converter.makeHtml(widenMarkdownTableSeparators(lines.slice(i, end).join("\n")));
			const table = template.content.querySelector("table");
			if ( table ) {
				parts.push(normalizedTableHtml(table));
				found = true;
				i = end - 1;
				continue
			}
		}
		parts.push(`<div>${escapeHtmlText(lines[i]) || "<br>"}</div>`);
	}
	if ( !found ) { return null }
	while ( parts[0] === "<div><br></div>" ) { parts.shift() }
	while ( parts.at(-1) === "<div><br></div>" ) { parts.pop() }
	return parts.join("");
}

function handleTablePaste(e){
	if ( e.defaultPrevented ) { return }
	const editor = e.target.closest?.(".editor");
	if ( !editor?.isContentEditable ) { return }
	const html = e.clipboardData?.getData("text/html");
	const content = (html && pastedTablesFromHtml(html)) || pastedTablesFromMarkdown(e.clipboardData?.getData("text/plain") || "");
	if ( !content ) { return }
	e.preventDefault();
	// into a cell, a single cell's content stays in it; anything bigger goes after the table
	const selection = window.getSelection();
	const template = document.createElement("template");
	template.innerHTML = content;
	const only = template.content.childNodes.length === 1 && template.content.firstChild.nodeName === "TABLE" ? template.content.firstChild : null;
	if ( selection.rangeCount && cellOf(selection.anchorNode) && only?.rows.length === 1 && only.rows[0].cells.length === 1 ) {
		document.execCommand("insertHTML", false, only.rows[0].cells[0].innerHTML);
		return
	}
	insertTablesHtml(content);
}

function handleTableTab(e){
	// Tab: the next cell (a new row after the last one), Shift+Tab: the previous one
	if ( e.key !== "Tab" || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey ) { return }
	const selection = window.getSelection();
	const cell = selection.rangeCount ? cellOf(selection.anchorNode) : null;
	if ( !cell?.closest(".editor")?.isContentEditable ) { return }
	e.preventDefault();
	const { table } = cellPosition(cell);
	const cells = [...table.querySelectorAll("td, th")].filter((c) => c.closest("table") === table);
	const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
	if ( next ) { caretToCell(next); updateCaretPosition(); return }
	if ( e.shiftKey ) { return }
	changeTable(cell, (grid) => {
		grid.rows.push(Array(grid.rows[0].length).fill(""));
		return [grid.rows.length - 1, 0];
	});
}

function handleTableArrow(e){
	// Up / Down into, through and out of a table go to the cell above / below the caret (the browser goes to the
	// previous / next cell), past the table's top or bottom to the line before / after it; inside a cell of several
	// lines and anywhere else they move as the browser moves them
	if ( (e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey ) { return }
	const selection = window.getSelection();
	const editor = e.target.closest?.(".editor");
	if ( !editor?.isContentEditable || !selection.rangeCount || !selection.isCollapsed || !editor.contains(selection.focusNode) ) { return }
	const up = e.key === "ArrowUp";
	const cell = cellOf(selection.focusNode);
	const caret = selection.getRangeAt(0);
	const rect = caret.getBoundingClientRect();
	const x = rect.height ? rect.left : (cell || elementOf(selection.focusNode)).getBoundingClientRect().left;
	selection.modify("move", up ? "backward" : "forward", "line");
	const landed = cellOf(selection.focusNode);
	const keep = landed === cell; // inside the cell, or outside of tables
	selection.removeAllRanges();
	selection.addRange(caret);
	if ( keep ) { return }
	let target = null;
	if ( cell ) {
		const { table, row } = cellPosition(cell);
		const next = tableRows(table)[row + (up ? -1 : 1)];
		target = next ? cellAtX(next, x) : (up ? table.previousElementSibling : table.nextElementSibling);
	} else {
		const rows = tableRows(landed.closest("table"));
		target = cellAtX(up ? rows.at(-1) : rows[0], x);
	}
	if ( !target ) { return }
	e.preventDefault();
	// the caret keeps its place across: on the target's last line going up, its first going down
	const box = target.getBoundingClientRect();
	const style = getComputedStyle(target);
	const left = box.left + parseFloat(style.paddingLeft);
	const right = box.right - parseFloat(style.paddingRight) - 1;
	const y = up ? box.bottom - parseFloat(style.paddingBottom) - 2 : box.top + parseFloat(style.paddingTop) + 2;
	const point = caretRangeAt(Math.max(left, Math.min(x, right)), y);
	if ( point && target.contains(point.startContainer) ) {
		selection.removeAllRanges();
		selection.addRange(point);
		revealCell(target.closest?.("td, th"));
	} else {
		caretToCell(target, up);
	}
	updateCaretPosition();
}

function tableRows(table){
	return [...table.rows].filter((tr) => tr.closest("table") === table);
}

function cellAtX(row, x){
	// the row's cell under x, or the nearest one
	const cells = [...row.cells];
	return cells.find((cell) => cell.getBoundingClientRect().right > x) || cells.at(-1);
}

function caretRangeAt(x, y){
	if ( document.caretRangeFromPoint ) { return document.caretRangeFromPoint(x, y) }
	const position = document.caretPositionFromPoint?.(x, y);
	if ( !position ) { return null }
	const range = document.createRange();
	range.setStart(position.offsetNode, position.offset);
	return range;
}

function handleTableRowMove(e){
	// Cmd+Ctrl+ArrowUp/ArrowDown (or k/j): the caret's row, or the rows of the selected cells, go above / below their
	// neighbour, like list items (script.js); the header row stays the first one
	if ( !e.metaKey || !e.ctrlKey || e.altKey || e.shiftKey ) { return }
	const up = e.key === "ArrowUp" || e.key.toLowerCase() === "k";
	if ( !up && e.key !== "ArrowDown" && e.key.toLowerCase() !== "j" ) { return }
	const selection = window.getSelection();
	const cell = selection.rangeCount ? cellOf(selection.focusNode) : null;
	if ( !cell?.closest(".editor")?.isContentEditable ) { return }
	e.preventDefault();
	e.stopPropagation();
	const { table } = cellPosition(cell);
	const cells = tableSelection?.table === table && tableSelection.cells.has(cell) ? [...tableSelection.cells] : [cell, cellOf(selection.anchorNode)];
	const rows = tableRows(table);
	const indexes = cells.filter((c) => c?.closest("table") === table).map((c) => rows.indexOf(c.parentElement));
	const moved = rows.slice(Math.min(...indexes), Math.max(...indexes) + 1);
	if ( moved.some((tr) => tr.parentElement.nodeName === "THEAD") ) { return }
	const neighbour = up ? moved[0].previousElementSibling : moved.at(-1).nextElementSibling;
	if ( neighbour?.nodeName !== "TR" ) { return }
	// moving the nodes drops the selection: it comes back on the same text
	const kept = [selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset];
	up ? neighbour.before(...moved) : neighbour.after(...moved);
	selection.setBaseAndExtent(...kept);
	updateCaretPosition();
	moved[0].scrollIntoView({ block: "nearest" });
	scheduleTableSelection();
	// a change like after an edit (unsaved tab, autosave)
	const editor = table.closest(".editor");
	editor.dispatchEvent(new Event("input", { bubbles: true }));
	if ( editor.id === "editor" ) { performAutoSave() }
}

let tablePointerType = "mouse"; // of the last press in the editors: a touch's long press brings the context menu too

function handleTableContextMenu(e){
	if ( e.shiftKey ) { return } // the browser's own menu
	const cell = e.target.closest?.(tableCellSelector);
	if ( !cell?.closest(".editor")?.isContentEditable ) { return }
	// a long press on a touch screen selecting text: the system's menu for it (copy, paste...), the table's one is in
	// the toolbar's "Table"
	const selection = window.getSelection();
	const touch = (e.pointerType || tablePointerType) === "touch";
	if ( touch && !selection.isCollapsed && cell.contains(selection.anchorNode) && cell.contains(selection.focusNode) ) { return }
	openContextMenu(e, tableMenuItems(cell));
}

// the setting: a copied table's text is Markdown or HTML (goes with the notebook)
function tableCopyAsHtml(){
	return notebookStorage.getItem(tableCopyKey) === "html";
}

function tableSettingsHtml(){
	// the Tables section of Settings (createSettingsModal, script.js)
	const html = tableCopyAsHtml();
	return `
		<label class="check"><input type="radio" name="setting-table-copy" value="markdown"${html ? "" : " checked"}>Copy tables as Markdown</label>
		<label class="check"><input type="radio" name="setting-table-copy" value="html"${html ? " checked" : ""}>Copy tables as HTML</label>
		<p class="muted small">What a copied table pastes as text. Pasted into Write.JS or a document editor it stays a table either way.</p>`;
}

function initTableSettings(){
	document.querySelectorAll('input[name="setting-table-copy"]').forEach((input) => input.addEventListener("change", (e) => {
		if ( !validateUserConsent() ) { e.target.checked = false; return }
		notebookStorage.setItem(tableCopyKey, e.target.value);
		if ( typeof handleRemoteAutosave !== "undefined" ) { handleRemoteAutosave() } // the setting goes to the cloud with the notebook
	}));
}

// selected cells: {table, cells: Set}; drawn over the cells in the editor's card, outside the document
let tableSelection = null;
const tableSelectionLayers = new Map(); // editor -> its layer
let tableSelectionFrame = 0;

function cellsBetween(a, b){
	const from = cellPosition(a);
	const to = cellPosition(b);
	const rows = [...from.table.rows].filter((tr) => tr.closest("table") === from.table);
	const cells = new Set();
	for ( let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++ ) {
		for ( let c = Math.min(from.column, to.column); c <= Math.max(from.column, to.column); c++ ) {
			if ( rows[r]?.cells[c] ) { cells.add(rows[r].cells[c]) }
		}
	}
	return cells;
}

function setTableSelection(value){
	tableSelection = value && value.cells.size ? value : null;
	scheduleTableSelection();
}

function handleTableSelectionChange(){
	// a selection from a cell to another of the same table selects the cells between; a Ctrl/Cmd+click selection
	// stays until the selection changes
	const selection = window.getSelection();
	if ( !selection.rangeCount ) { return }
	const anchor = cellOf(selection.anchorNode);
	const focus = cellOf(selection.focusNode);
	if ( anchor && focus && anchor !== focus && anchor.closest("table") === focus.closest("table") ) {
		setTableSelection({ table: anchor.closest("table"), cells: cellsBetween(anchor, focus) });
	} else if ( tableSelection ) {
		const kept = tableSelection.caret;
		if ( !kept || kept.node !== selection.focusNode || kept.offset !== selection.focusOffset || !selection.isCollapsed ) { setTableSelection(null) }
	}
}

function handleTableCellToggle(e){
	// a right-click on a selected cell keeps the selection, for its menu
	if ( e.button === 2 && tableSelection?.cells.has(e.target.closest?.(tableCellSelector)) ) { e.preventDefault(); return }
	// Ctrl+click (Cmd+click on Apple devices) adds a cell to the selected ones, or takes it away
	const apple = document.body.classList.contains("apple-platform");
	if ( e.button !== 0 || !(apple ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey ) { return }
	const cell = e.target.closest?.(tableCellSelector);
	if ( !cell?.closest(".editor")?.isContentEditable || e.target.closest("a") ) { return }
	e.preventDefault();
	const table = cell.closest("table");
	const cells = new Set(tableSelection?.table === table ? tableSelection.cells : []);
	const caret = caretCell();
	if ( !cells.size && caret && caret !== cell && caret.closest("table") === table ) { cells.add(caret) }
	cells.has(cell) ? cells.delete(cell) : cells.add(cell);
	// the caret doesn't move: the selection is kept until it does
	const selection = window.getSelection();
	setTableSelection({ table, cells, caret: { node: selection.focusNode, offset: selection.focusOffset } });
}

function scheduleTableSelection(){
	if ( tableSelectionFrame ) { return }
	tableSelectionFrame = requestAnimationFrame(() => {
		tableSelectionFrame = 0;
		renderTableSelection();
	});
}

function renderTableSelection(){
	if ( tableSelection && !tableSelection.table.isConnected ) { tableSelection = null }
	const editor = tableSelection?.table.closest(".editor");
	for ( const [other, layer] of tableSelectionLayers ) {
		if ( other !== editor ) {
			layer.remove();
			tableSelectionLayers.delete(other);
			other.classList.remove("table-cells-selected");
		}
	}
	if ( !editor ) { return }
	let layer = tableSelectionLayers.get(editor);
	const card = editor.closest(".editor-card");
	if ( !layer || layer.parentElement !== card ) {
		layer = document.createElement("div");
		layer.className = "table-selection-layer";
		card.append(layer);
		tableSelectionLayers.set(editor, layer);
	}
	// the browser's own highlight of the text in the cells would only show parts of them
	editor.classList.toggle("table-cells-selected", tableSelection.cells.size > 1);
	const origin = layer.getBoundingClientRect();
	// a table scrolled sideways shows only some of its cells
	const shown = tableSelection.table.getBoundingClientRect();
	layer.replaceChildren(...[...tableSelection.cells].filter((cell) => cell.isConnected).flatMap((cell) => {
		const rect = cell.getBoundingClientRect();
		const left = Math.max(rect.left, shown.left);
		const right = Math.min(rect.right, shown.right);
		if ( right <= left ) { return [] }
		const box = document.createElement("div");
		box.className = "table-selection-cell";
		box.style.cssText = `top: ${rect.top - origin.top}px; left: ${left - origin.left}px; width: ${right - left}px; height: ${rect.height}px`;
		return [box];
	}));
}

function selectedCellsHtml(){
	// the selected cells as a table: the rows and columns with any of them, the cells between them empty
	const { table, cells } = tableSelection;
	const rows = [...table.rows].filter((tr) => tr.closest("table") === table);
	const places = [...cells].filter((cell) => cell.isConnected).map(cellPosition);
	const usedRows = [...new Set(places.map((p) => p.row))].sort((a, b) => a - b);
	const usedColumns = [...new Set(places.map((p) => p.column))].sort((a, b) => a - b);
	const grid = usedRows.map((r) => usedColumns.map((c) => {
		const cell = rows[r].cells[c];
		return cell && cells.has(cell) ? cell.innerHTML : "";
	}));
	const hasHead = usedRows[0] === 0 && tableModel(table).head !== null;
	return tableHtml({ head: hasHead ? grid[0] : null, body: hasHead ? grid.slice(1) : grid });
}

function handleTableCopy(e){
	// selected cells, or a selection with a table in it (not text in one cell): the table in the HTML, Markdown or
	// HTML in the text (Settings)
	if ( e.defaultPrevented || !e.clipboardData ) { return }
	const editor = e.target.closest?.(".editor");
	if ( !editor ) { return }
	let html = null;
	if ( tableSelection && editor.contains(tableSelection.table) && tableSelection.cells.size > 1 ) {
		html = selectedCellsHtml();
	} else {
		const selection = window.getSelection();
		if ( !selection.rangeCount || selection.isCollapsed ) { return }
		const range = selection.getRangeAt(0);
		if ( !editor.contains(range.commonAncestorContainer) ) { return }
		if ( ![...editor.querySelectorAll("table")].some((table) => range.intersectsNode(table)) ) { return }
		const start = cellOf(range.startContainer);
		if ( start && start === cellOf(range.endContainer) ) { return }
		const box = document.createElement("div");
		box.append(range.cloneContents());
		html = box.innerHTML;
	}
	e.preventDefault();
	e.clipboardData.setData("text/html", html);
	e.clipboardData.setData("text/plain", tableCopyAsHtml() ? html : getContentAsMarkdown(html));
}

document.getElementById("editor-grid").addEventListener("paste", handleTablePaste);
document.getElementById("editor-grid").addEventListener("copy", handleTableCopy);
document.getElementById("editor-grid").addEventListener("mousedown", handleTableCellToggle);
document.addEventListener("selectionchange", handleTableSelectionChange);
window.addEventListener("resize", scheduleTableSelection);
// capture: scrolling doesn't bubble, a wide table scrolls on its own
document.getElementById("editor-grid").addEventListener("scroll", (e) => { if ( e.target.nodeName === "TABLE" ) { scheduleTableSelection() } }, true);
document.getElementById("editor-grid").addEventListener("input", scheduleTableSelection);
// capture: before the Tab of the lines (script.js)
document.getElementById("editor-grid").addEventListener("keydown", handleTableTab, true);
document.getElementById("editor-grid").addEventListener("contextmenu", handleTableContextMenu);
document.getElementById("editor-grid").addEventListener("pointerdown", (e) => { tablePointerType = e.pointerType }, true);
document.getElementById("editor-grid").addEventListener("keydown", handleTableArrow);
// capture: before the caret moves with the arrow
document.getElementById("editor-grid").addEventListener("keydown", handleTableRowMove, true);
document.getElementById("tb-btn-table").addEventListener("click", () => { formatText("table") });
