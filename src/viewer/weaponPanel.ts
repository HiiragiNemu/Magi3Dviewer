import * as THREE from 'three'
import { specialWeaponDefinitions, loadSpecialWeapon } from './specialWeapons'
import MagiaExedraCharacterThree from 'magia-exedra-character-three'
import { startLoadingTask } from 'magia-exedra-character-three/loadingProgress'
import { translateUiText } from './localization/zhCN'
import { createIndependentWeapon, listIndependentWeapons, setIndependentWeaponTransform, type IndependentWeapon, type WeaponDonor } from './independentWeapons'

export interface WeaponPanelOptions {
    files: Record<string, string>
    characters: readonly { id: string; name: string }[]
    scene: THREE.Scene
    initialPosition(): THREE.Vector3
    transform(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale', refresh: () => void): void
    detach(object: THREE.Object3D): void
    closeTransform(): void
}

export function setupWeaponPanel(options: WeaponPanelOptions) {
    const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
    const panel = get<HTMLElement>('weapon-panel')
    const toggle = get<HTMLButtonElement>('weapon-panel-toggle')
    const source = get<HTMLSelectElement>('weapon-character')
    const search = get<HTMLInputElement>('weapon-search')
    const load = get<HTMLButtonElement>('weapon-load')
    const choices = get<HTMLSelectElement>('weapon-choice')
    const add = get<HTMLButtonElement>('weapon-add')
    const instances = get<HTMLSelectElement>('weapon-instances')
    const remove = get<HTMLButtonElement>('weapon-remove')
    const clear = get<HTMLButtonElement>('weapon-clear')
    const status = get<HTMLOutputElement>('weapon-status')
    const fields = get<HTMLFieldSetElement>('weapon-transform-fields')
    const manager = new MagiaExedraCharacterThree(options.files) // no character physics/locomotion registration
    const props = new Map<string, IndependentWeapon>()
    let prepared: { donor: WeaponDonor; id: string } | undefined
    let operation: AbortController | undefined
    let serial = 0
    let statusKey = 'Choose a character, then load weapons'
    let statusDetail = ''
    const setStatus = (key: string, detail = '') => {
        statusKey = key; statusDetail = detail
        status.textContent = translateUiText(key) + (detail ? `: ${detail}` : '')
    }
    const selected = () => props.get(instances.value)
    const releasePrepared = () => { prepared?.donor.dispose(); prepared = undefined }
    const setBusy = (busy: boolean) => {
        load.disabled = busy || !source.value
        source.disabled = search.disabled = busy
        choices.disabled = busy || !choices.options.length
        add.disabled = busy || !choices.value
    }
    const refreshTransform = () => {
        const prop = selected()
        fields.disabled = remove.disabled = !prop
        clear.disabled = !props.size
        if (!prop) return
        for (const input of fields.querySelectorAll<HTMLInputElement>('input[data-channel]')) {
            if (document.activeElement === input) continue
            const channel = input.dataset.channel as 'position' | 'rotation' | 'scale'
            const axis = input.dataset.axis as 'x' | 'y' | 'z'
            const value = prop.object[channel][axis]
            input.value = (channel === 'rotation' ? THREE.MathUtils.radToDeg(value) : value).toFixed(3)
        }
    }
    const refreshInstances = () => {
        const old = instances.value
        instances.replaceChildren(...[...props].map(([id, prop]) => new Option(`${id} · ${prop.characterId} · ${prop.weaponName}`, id)))
        if (props.has(old)) instances.value = old
        instances.disabled = !props.size
        refreshTransform()
    }
    const resetChoices = () => {
        releasePrepared(); choices.replaceChildren(); setBusy(false)
        setStatus('Choose a character, then load weapons')
    }
    const filterCharacters = () => {
        const old = source.value, query = search.value.trim().toLowerCase()
        source.replaceChildren(...options.characters.filter(item => `${item.id} ${item.name}`.toLowerCase().includes(query))
            .map(item => new Option(`${item.id} — ${item.name}`, item.id)))
        if ([...source.options].some(item => item.value === old)) source.value = old
        if (source.value !== old) resetChoices()
        setBusy(false)
    }
    async function loadDonor(id: string, signal: AbortSignal) {
        const task = startLoadingTask('武器加载', signal)
        try {
            const donor = await manager.loadCharacterById(id, { signal })
            task.complete()
            return donor
        } catch (error) { task.fail(error); throw error }
    }
    load.onclick = async () => {
        releasePrepared(); choices.replaceChildren(); setBusy(true)
        const controller = new AbortController(); operation = controller
        setStatus('Loading weapons')
        try {
            const id = source.value, donor = await loadDonor(id, controller.signal)
            if (controller.signal.aborted) { donor.dispose(); return }
            prepared = { donor, id }
            choices.replaceChildren(
                ...listIndependentWeapons(donor.object).map(item => new Option(item.name, item.key)),
                ...specialWeaponDefinitions.filter(item => item.characterId === id).map(item => new Option(item.name, item.modelName)),
            )
            if (!choices.options.length) releasePrepared()
            setStatus(choices.options.length ? 'Weapons ready' : 'No weapon in this model', `${choices.options.length}`)
        } catch (error) { if (!controller.signal.aborted) setStatus('Weapon load failed', String(error)) }
        finally { if (operation === controller) { operation = undefined; setBusy(false) } }
    }
    add.onclick = async () => {
        if (!choices.value || operation) return
        const controller = new AbortController(); operation = controller; setBusy(true)
        let donor: WeaponDonor | undefined
        try {
            const id = source.value, key = choices.value
            const special = specialWeaponDefinitions.find(item => item.characterId === id && item.modelName === key)
            if (special) {
                releasePrepared()
                const task = startLoadingTask('武器加载', controller.signal)
                try { donor = await loadSpecialWeapon(special, controller.signal); task.complete() }
                catch (error) { task.fail(error); throw error }
            } else {
                donor = prepared?.id === id ? prepared.donor : await loadDonor(id, controller.signal)
                prepared = undefined
            }
            if (controller.signal.aborted) { donor.dispose(); return }
            const prop = createIndependentWeapon(donor, id, key)
            donor = undefined // ownership transferred to prop
            prop.object.position.copy(options.initialPosition())
            options.scene.add(prop.object)
            const instanceId = String(++serial)
            props.set(instanceId, prop); refreshInstances(); instances.value = instanceId
            refreshTransform()
            options.transform(prop.object, 'translate', refreshTransform)
            setStatus('Weapon added', prop.weaponName)
        } catch (error) { donor?.dispose(); if (!controller.signal.aborted) setStatus('Weapon load failed', String(error)) }
        finally { if (operation === controller) { operation = undefined; setBusy(false) } }
    }
    const removeProp = (id: string) => {
        const prop = props.get(id)
        if (prop) { options.detach(prop.object); prop.dispose(); props.delete(id) }
    }
    remove.onclick = () => { removeProp(instances.value); refreshInstances() }
    clear.onclick = () => { for (const id of props.keys()) removeProp(id); refreshInstances() }
    instances.onchange = () => {
        refreshTransform()
        const prop = selected(); if (prop) options.transform(prop.object, 'translate', refreshTransform)
    }
    for (const button of fields.querySelectorAll<HTMLButtonElement>('[data-transform]')) {
        button.onclick = () => {
            const prop = selected()
            if (prop) options.transform(prop.object, button.dataset.transform as 'translate' | 'rotate' | 'scale', refreshTransform)
        }
    }
    for (const input of fields.querySelectorAll<HTMLInputElement>('input[data-channel]')) {
        input.oninput = () => {
            const prop = selected()
            if (prop && input.value.trim()) setIndependentWeaponTransform(prop.object,
                input.dataset.channel as 'position' | 'rotation' | 'scale', input.dataset.axis as 'x' | 'y' | 'z', input.valueAsNumber)
        }
        input.onchange = () => { input.blur(); refreshTransform() }
    }
    get<HTMLButtonElement>('weapon-axis-close').onclick = options.closeTransform
    source.onchange = resetChoices
    search.oninput = filterCharacters
    const setOpen = (open: boolean) => {
        panel.classList.toggle('is-open', open)
        panel.setAttribute('aria-hidden', String(!open)); toggle.setAttribute('aria-expanded', String(open))
        if (!open && prepared) releasePrepared()
    }
    toggle.onclick = () => setOpen(!panel.classList.contains('is-open'))
    get<HTMLButtonElement>('weapon-panel-close').onclick = () => setOpen(false)
    const onLocale = () => setStatus(statusKey, statusDetail)
    document.addEventListener('magius:localechange', onLocale)
    filterCharacters(); refreshInstances(); setStatus(statusKey)
    return {
        dispose() {
            operation?.abort(); operation = undefined; releasePrepared()
            for (const id of props.keys()) removeProp(id)
            document.removeEventListener('magius:localechange', onLocale)
        },
    }
}
