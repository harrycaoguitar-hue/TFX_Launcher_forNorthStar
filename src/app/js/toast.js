function Toast(properties) {
	let toast = {
		timeout: 3000,
		fg: "#FFFFFF",
		bg: "var(--selbg)",
		callback: () => {},
		title: "Untitled Toast",
		description: "No description provided for toast",
		...properties
	}

	switch(toast.scheme) {
		case "error":
			toast.fg = "#FFFFFF";
			toast.bg = "rgb(var(--red))";
			break
		case "success":
			toast.fg = "#FFFFFF";
			toast.bg = "#60D394";
			break
		case "warning":
			toast.fg = "#FFFFFF";
			toast.bg = "#FF9B85";
			break
	}


	let id = Date.now();
	if (document.getElementById(id)) {id = id + 1}
	let el = document.createElement("div");

	el.classList.add("toast");
	el.dataset.scheme = toast.scheme || "info";
	if (typeof toast.key === "string" && toast.key) el.dataset.toastKey = toast.key;

	el.style.color = toast.fg;
	el.style.background = toast.bg;

	el.id = id;
	el.addEventListener("click", () => {
		dismissToast(id);
		toast.callback();
	})

	let title = document.createElement("div");
	title.classList.add("title");
	title.textContent = toast.title;

	let description = document.createElement("div");
	description.classList.add("description");
	description.textContent = toast.description;

	el.append(title, description);

	if (! toast.title) {
		el.querySelector(".title").remove();
	}

	if (! toast.description) {
		el.querySelector(".description").remove();
	}

	toasts.appendChild(el);

	setTimeout(() => {
		dismissToast(id);
	}, toast.timeout)
}

function dismissToast(id) {
	id = document.getElementById(id);
	if (id) {
		id.classList.add("hidden");
		setTimeout(() => {
			id.remove();
		}, 500)
	}
}
