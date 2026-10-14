const fs = require("fs");
const repair = require("jsonrepair");

function read(file) {
	let json = false;

	// make sure the file actually exists
	if (! fs.existsSync(file)) {
		return false;
	}

	// make sure we're actually reading a file
	let file_content;
	try {
		if (!fs.statSync(file).isFile()) return false;
		file_content = fs.readFileSync(file, "utf8");
	} catch (_) { return false; }

	// attempt to parse it
	try {
		json = JSON.parse(file_content);
	}catch(err) {
		// attempt to repair then parse
		try {
			json = JSON.parse(repair(file_content));
		}catch(repair_err) {
			return false;
		}
	}

	if (json === null || typeof json !== "object") {
		return false;
	}

	return json;
}

module.exports = read;
