import GUI, { type KeyToValueOfType } from 'three/addons/libs/lil-gui.module.min.js';

export function createSquareExponentController<T, K extends KeyToValueOfType<T, number>>(gui: GUI, obj: T, key: K, min: number, max: number) {
    const fakeObj = { [key]: obj[key] } as T
    const controller = gui.add(fakeObj, key, min, max)

    // hook change, convert fake value in the object to real
    let onChangeCallback = (_value: T[K]) => { }
    controller.onChange(_ => {
        handleChange() // injection: process the change
        onChangeCallback(obj[key]) // callback the processed value
        // console.log(obj[key])
    })
    controller.onChange = (callback: typeof onChangeCallback) => {
        onChangeCallback = callback
        return controller
    }

    let loadMode = false

    // hook load, treat object value as real value
    if (!('origLoad' in gui)) {
        Object.assign(gui, { origLoad: gui.load.bind(gui) })
        if (!('origLoad' in gui)) throw new Error('GUI.load hook error: GUI does not have property origLoad');

        gui.load = (obj: object, recursive?: boolean) => {
            if (typeof gui.origLoad != 'function') throw new Error('GUI.load hook error: GUI.origLoad is not a function');

            loadMode = true
            const g = gui.origLoad(obj, recursive)
            loadMode = false
            return g
        }
    }

    const minExponent = Math.log2(min)
    const maxExponent = Math.log2(max)

    const origInitialValue = controller.initialValue as number

    let lastValue: number | undefined = undefined
    handleChange()

    function handleChange() {
        if (!(typeof controller._min == 'number' && typeof controller._max == 'number')) return
        if (getObjectValue() == lastValue) return

        let exponent
        if (lastValue == undefined || loadMode) { // first change / load mode: object value is real
            exponent = Math.round(Math.log2(getObjectValue()))
        } else { // user input: object value is fake, convert it to real value
            const fraction = (getObjectValue() - controller._min) / (controller._max - controller._min)
            exponent = Math.round(fraction * (maxExponent - minExponent)) + minExponent
        }
        if (exponent < minExponent) {
            exponent = minExponent
        } else if (exponent > maxExponent) {
            exponent = maxExponent
        }
        setObjectValue(Math.pow(2, exponent))

        // if (getObjectValue() == shadowResolutionLastValue) return
        lastValue = getObjectValue()

        controller.min(min)

        if (exponent == minExponent) {
            controller.max(max)
        } else {
            controller.max(getObjectValue() + (getObjectValue() - min) * (maxExponent - exponent) / (exponent - minExponent))
        }

        controller.initialValue = ((Math.round(Math.log2(origInitialValue)) - minExponent) / (maxExponent - minExponent) * (controller._max - controller._min) + controller._min) as T[K]

        controller.updateDisplay()
        // console.log(getObjectValue())
    }

    function getObjectValue() {
        return fakeObj[key] as number
    }

    function setObjectValue(value: number) {
        (fakeObj[key] as number) = value;
        (obj[key] as number) = value;
    }

    return controller
}
