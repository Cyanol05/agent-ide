/**
 * Base class for all agent managers.
 * Provides common lifecycle methods and resource cleanup functionality.
 */
export class BaseAgentManager {
	agent
	constructor(agent) {
		this.agent = agent
	}
	/**
	 * Set of cleanup functions to be called when the manager is disposed.
	 * Subclasses can add disposables during initialization or operation.
	 * @protected
	 */
	disposables = new Set()
	/**
	 * Clean up all resources held by this manager.
	 * Calls all registered dispose functions and clears the disposables set.
	 */
	dispose() {
		for (const fn of this.disposables) {
			fn()
		}
		this.disposables.clear()
	}
}
