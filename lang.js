function lang(key) {
	return window.I18n ? I18n.t(key) : fold.translate(key);
}

// Replaces built-in text placeholders with the bundled Chinese strings.
function setlang() {
	if (window.I18n) return I18n.apply();
	const replace = value => value.replace(/%%([^%]+)%%/g, (_match, key) => lang(key));
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
	const textNodes = [];

	while (walker.nextNode()) {
		textNodes.push(walker.currentNode);
	}

	for (const node of textNodes) {
		node.nodeValue = replace(node.nodeValue);
	}

	for (const element of document.body.querySelectorAll("*")) {
		for (const attribute of element.attributes) {
			if (attribute.value.includes("%%")) {
				element.setAttribute(attribute.name, replace(attribute.value));
			}
		}
	}
}
