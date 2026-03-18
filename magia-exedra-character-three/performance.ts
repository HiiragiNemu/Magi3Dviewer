export class PerformanceController {
    domElement = document.createElement('span')
    title: string
    time: number | undefined = undefined
    badFramerateThreshold = 60

    constructor(title: string) {
        this.title = title
    }

    start() {
        this.time = performance.now()
    }

    stop() {
        if (this.time == undefined) {
            this.clear()
            return
        }
        this.domElement.innerHTML = `${this.title}: ${this._ms2html(performance.now() - this.time)}`
    }

    clear() {
        this.time = undefined
        this.domElement.innerHTML = ''
    }

    private _ms2html(ms: number) {
        const msStr = ms.toFixed(1)
        if (ms < 1000 / this.badFramerateThreshold) {
            return msStr + ' ms'
        } else {
            return /*html*/`<span class="perf-bad">${msStr} ms</span>`
        }
    }
}
