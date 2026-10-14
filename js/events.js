const events = {
	listeners: new Map(),
	on(name, listener) {
		const listeners = this.listeners.get(name) || [];
		listeners.push(listener);
		this.listeners.set(name, listeners);
	},
	emit(name, value) {
		for (const listener of this.listeners.get(name) || []) {
			listener(value);
		}
	}
};
