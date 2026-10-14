var servercount;
var playercount;
var masterserver;

// Changes the main page
// This is the tabs in the sidebar
function page(page) {
	let btns = document.querySelectorAll(".gamesContainer button");
	let pages = document.querySelectorAll(".mainContainer .contentContainer");

	for (let i = 0; i < pages.length; i++) {
		pages[i].classList.add("hidden");
	}

	for (let i = 0; i < btns.length; i++) {
		btns[i].classList.add("inactive");
	}

	pages[page].classList.remove("hidden");
	btns[page].classList.remove("inactive");
	bgHolder.setAttribute("bg", page);
}; page(1)

function formatRelease(notes) {
	if (! Array.isArray(notes)) {return ""}

	let escapeHtml = (value) => String(value || "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

	let formatBody = (body) => {
		let output = [];
		let listItems = [];
		let flushList = () => {
			if (listItems.length) {
				output.push("<ul>" + listItems.join("") + "</ul>");
				listItems = [];
			}
		};

		for (let rawLine of String(body || "").replaceAll("\r", "").split("\n")) {
			let line = rawLine.trim();
			if (! line) {
				flushList();
				continue;
			}

			let heading = line.match(/^(#{1,3})\s+(.+)$/);
			if (heading) {
				flushList();
				let level = heading[1].length + 2;
				output.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
				continue;
			}

			let listItem = line.match(/^[-*]\s+(.+)$/);
			if (listItem) {
				listItems.push("<li>" + escapeHtml(listItem[1]) + "</li>");
				continue;
			}

			flushList();
			output.push("<p>" + escapeHtml(line) + "</p>");
		}

		flushList();
		return output.join("");
	};

	return notes.filter(release => ! release.prerelease).map((release) => {
		let date = release.created_at ? new Date(release.created_at).toLocaleString(window.I18n?.current) : "";
		return "<div class='release-block'><h3>" + escapeHtml(release.name) +
			"</h3><p>" + escapeHtml(date) + "</p>" +
			formatBody(release.body) + "</div>";
	}).join("");
}

// sets content of `div` to a single release block with centered text
// inside it, the text being `lang(lang_key)`
let set_error_content = (div, lang_key) => {
	div.innerHTML =
		"<div class='release-block'>" +
			"<p><center>" +
				lang(lang_key) +
			"</center></p>" +
		"</div>";
}

// Updates the Viper release notes
ipcRenderer.on("vp-notes", (event, response) => {
	if (! response) {
		return set_error_content(
			vpReleaseNotes,
			"request.no_vp_release_notes"
		)
	}

	vpReleaseNotes.innerHTML = formatRelease(response);
});

// Updates the Northstar release notes
ipcRenderer.on("ns-notes", (event, response) => {
	if (! response) {
		return set_error_content(
			nsRelease,
			"request.no_ns_release_notes"
		)
	}

	nsRelease.innerHTML = formatRelease(response);
});

async function loadVpReleases() {
	ipcRenderer.send("get-vp-notes");	
};

async function loadNsReleases() {
	ipcRenderer.send("get-ns-notes");
};

// TODO: We gotta make this more automatic instead of switch statements
// it's both not pretty, but adding more sections requires way too much
// effort, compared to how it should be.
function showVpSection(section) {
	if (!["main", "release", "info", "credits"].includes(section)) throw new Error("unknown vp section");
	vpMainBtn.removeAttribute("active");
	vpReleaseBtn.removeAttribute("active");
	vpInfoBtn.removeAttribute("active");

	vpMain.classList.add("hidden");
	vpReleaseNotes.classList.add("hidden");
	vpInfo.classList.add("hidden");

	switch(section) {
		case "main":
			vpMainBtn.setAttribute("active", "");
			vpMain.classList.remove("hidden");
			break;
		case "release":
			vpReleaseBtn.setAttribute("active", "");
			vpReleaseNotes.classList.remove("hidden");
			break;
		case "info":
			vpInfoBtn.setAttribute("active", "");
			vpInfo.classList.remove("hidden");
			break;
	}
}

function showNsSection(section) {
	if (!["main", "release", "mods"].includes(section)) {
		throw new Error("unknown ns section");
	}

	nsMainBtn.removeAttribute("active");
	nsModsBtn.removeAttribute("active");
	nsReleaseBtn.removeAttribute("active");

	nsMain.classList.add("hidden");
	nsMods.classList.add("hidden");
	nsRelease.classList.add("hidden");

	switch(section) {
		case "main":
			nsMainBtn.setAttribute("active", "");
			nsMain.classList.remove("hidden");
			break;
		case "mods":
			nsModsBtn.setAttribute("active", "");
			nsMods.style.display = "block";
			nsMods.classList.remove("hidden");
			break;
		case "release":
			nsReleaseBtn.setAttribute("active", "");
			nsRelease.classList.remove("hidden");
			break;
	}
}

// The visible Northstar home owns live server refreshes in server-list.js.
