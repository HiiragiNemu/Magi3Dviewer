import * as THREE from 'three'
import { specialWeaponDefinitions, loadSpecialWeapon } from './specialWeapons'
import MagiaExedraCharacterThree from 'magia-exedra-character-three'
import { startLoadingTask } from 'magia-exedra-character-three/loadingProgress'
import { translateUiText } from './localization/zhCN'
import { createIndependentWeapon, listIndependentWeapons, type IndependentWeapon, type WeaponDonor } from './independentWeapons'

export interface WeaponPanelOptions {
    files: Record<string, string>
    characters: readonly { id: string; name: string }[]
    scene: THREE.Scene
    initialPosition(): THREE.Vector3
    currentCharacterId?(): string
    select?(object: THREE.Object3D, label: string, refresh: () => void): void
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
    const choices = get<HTMLSelectElement>('weapon-choice')
    const add = get<HTMLButtonElement>('weapon-add')
    const instances = get<HTMLSelectElement>('weapon-instances')
    const remove = get<HTMLButtonElement>('weapon-remove')
    const clear = get<HTMLButtonElement>('weapon-clear')
    const status = get<HTMLOutputElement>('weapon-status')
    const fields = get<HTMLFieldSetElement>('weapon-transform-fields')
    const manager = new MagiaExedraCharacterThree(options.files)
    const props = new Map<string, IndependentWeapon>()
    let prepared: { donor: WeaponDonor; id: string } | undefined
    let discovery: AbortController | undefined
    let adding: AbortController | undefined
    let serial = 0
    let opened = false
    let statusKey = 'Choose a character to add weapons'
    let statusDetail = ''
    const setStatus = (key: string, detail = '') => {
        statusKey = key; statusDetail = detail
        status.textContent = translateUiText(key) + (detail ? `: ${detail}` : '')
    }
    const selected = () => props.get(instances.value)
    const releasePrepared = () => { prepared?.donor.dispose(); prepared = undefined }
    const specialChoice = () => specialWeaponDefinitions.find(item => item.characterId === source.value && item.modelName === choices.value)
    const setBusy = () => {
        source.disabled = search.disabled = !!adding
        choices.disabled = !!adding || !choices.options.length
        add.disabled = !!adding || !choices.value || (!!discovery && !specialChoice())
    }
    const refreshTransform = () => {
        fields.disabled = remove.disabled = !selected()
        clear.disabled = !props.size
    }
    const refreshInstances = () => {
        const old = instances.value
        instances.replaceChildren(...[...props].map(([id, prop]) => new Option(`${id} · ${prop.characterId} · ${prop.weaponName}`, id)))
        if (props.has(old)) instances.value = old
        instances.disabled = !props.size
        refreshTransform()
    }
    const selectObject = (object: THREE.Object3D) => {
        const entry = [...props].find(([, prop]) => prop.object === object)
        if (!entry) return
        instances.value = entry[0]; refreshTransform()
        const prop = entry[1]
        options.select?.(prop.object, `${prop.characterId} · ${prop.weaponName}`, refreshTransform)
    }
    async function loadDonor(id: string, signal: AbortSignal) {
        const task = startLoadingTask('武器加载', signal)
        try { const donor = await manager.loadCharacterById(id, { signal }); task.complete(); return donor }
        catch (error) { task.fail(error); throw error }
    }
    async function discoverWeapons() {
        discovery?.abort(); releasePrepared()
        const id = source.value
        const specials = specialWeaponDefinitions.filter(item => item.characterId === id)
        // Special weapons are independent resources: do not gate them on a whole-character load.
        choices.replaceChildren(...specials.map(item => new Option(item.name, item.modelName)))
        if (!id) { discovery = undefined; setBusy(); return }
        const controller = new AbortController(); discovery = controller
        setStatus('Loading weapons'); setBusy()
        try {
            const donor = await loadDonor(id, controller.signal)
            if (controller.signal.aborted || discovery !== controller) { donor.dispose(); return }
            prepared = { donor, id }
            const previous = choices.value
            choices.replaceChildren(...listIndependentWeapons(donor.object).map(item => new Option(item.name, item.key)),
                ...specials.map(item => new Option(item.name, item.modelName)))
            if (previous) choices.value = previous
            if (!choices.options.length) releasePrepared()
            setStatus(choices.options.length ? 'Weapons ready' : 'No weapon in this model')
        } catch (error) {
            if (!controller.signal.aborted && discovery === controller) setStatus('Weapon load failed', String(error))
        } finally { if (discovery === controller) { discovery = undefined; setBusy() } }
    }
    const filterCharacters = () => {
        const old = source.value, query = search.value.trim().toLowerCase()
        source.replaceChildren(...options.characters.filter(item => `${item.id} ${item.name}`.toLowerCase().includes(query))
            .map(item => new Option(`${item.id} — ${item.name}`, item.id)))
        if ([...source.options].some(item => item.value === old)) source.value = old
        if (opened && source.value !== old) void discoverWeapons()
        setBusy()
    }
    add.onclick = async () => {
        if (!choices.value || adding || (discovery && !specialChoice())) return
        const id = source.value, key = choices.value, special = specialChoice()
        discovery?.abort(); discovery = undefined
        const controller = new AbortController(); adding = controller; setBusy()
        let donor: WeaponDonor | undefined
        setStatus('Loading weapons')
        try {
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
            donor = undefined
            prop.object.position.copy(options.initialPosition())
            options.scene.add(prop.object)
            const instanceId = String(++serial)
            props.set(instanceId, prop); refreshInstances(); instances.value = instanceId
            selectObject(prop.object)
            options.transform(prop.object, 'translate', refreshTransform)
            setStatus('Weapon added', prop.weaponName)
        } catch (error) { donor?.dispose(); if (!controller.signal.aborted) setStatus('Weapon load failed', String(error)) }
        finally { if (adding === controller) { adding = undefined; setBusy() } }
    }
    const removeProp = (id: string) => {
        const prop = props.get(id)
        if (prop) { options.detach(prop.object); prop.dispose(); props.delete(id) }
    }
    remove.onclick = () => { removeProp(instances.value); refreshInstances(); const prop = selected(); if (prop) selectObject(prop.object) }
    clear.onclick = () => { for (const id of props.keys()) removeProp(id); refreshInstances() }
    instances.onchange = () => { const prop = selected(); if (prop) selectObject(prop.object) }
    for (const button of fields.querySelectorAll<HTMLButtonElement>('[data-transform]')) {
        button.onclick = () => {
            const prop = selected()
            if (prop) { selectObject(prop.object); options.transform(prop.object, button.dataset.transform as 'translate' | 'rotate' | 'scale', refreshTransform) }
        }
    }
    get<HTMLButtonElement>('weapon-axis-close').onclick = options.closeTransform
    source.onchange = () => { void discoverWeapons() }
    choices.onchange = setBusy
    search.oninput = filterCharacters
    const setOpen = (open: boolean) => {
        panel.classList.toggle('is-open', open)
        panel.setAttribute('aria-hidden', String(!open)); toggle.setAttribute('aria-expanded', String(open))
        if (open && !adding) {
            if (!opened) {
                const current = options.currentCharacterId?.()
                if (current && [...source.options].some(item => item.value === current)) source.value = current
            }
            opened = true
            void discoverWeapons()
        } else if (!open) { discovery?.abort(); discovery = undefined; releasePrepared(); setBusy() }
    }
    toggle.onclick = () => setOpen(!panel.classList.contains('is-open'))
    get<HTMLButtonElement>('weapon-panel-close').onclick = () => setOpen(false)
    const onLocale = () => setStatus(statusKey, statusDetail)
    document.addEventListener('magius:localechange', onLocale)
    filterCharacters(); refreshInstances(); setStatus(statusKey)
    return {
        getInstances: () => [...props.values()], selectObject, refreshTransform,
        dispose() {
            discovery?.abort(); discovery = undefined; adding?.abort(); adding = undefined; releasePrepared()
            for (const id of props.keys()) removeProp(id)
            document.removeEventListener('magius:localechange', onLocale)
        },
    }
}
