// @vitest-environment jsdom
// The editor iframe follows the viewer's language: ?lang= on its URL when it opens,
// then 'set-language' messages while it is open (src/utils/editorLanguage.js, used
// by EditorModal and AdWizardFrame).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import i18n from '../../../src/i18n'
import { editorLang, editorUrlWithLang, useEditorLanguage } from '../../../src/utils/editorLanguage'

afterEach(async () => { await act(() => i18n.changeLanguage('en')) })

describe('editorLang / editorUrlWithLang', () => {
  it('passes language codes, refuses anything else', () => {
    expect(editorLang('de')).toBe('de')
    expect(editorLang('fil')).toBe('fil')
    expect(editorLang('pt-BR')).toBe('pt-BR')
    expect(editorLang('de"><script>')).toBe(null)
    expect(editorLang('')).toBe(null)
    expect(editorLang(undefined)).toBe(null)
  })
  it('adds lang to the editor URL and keeps its other params', () => {
    expect(editorUrlWithLang('https://editor.3speak.tv?compact=true&mode=audio', 'de')).toBe('https://editor.3speak.tv?compact=true&mode=audio&lang=de')
    expect(editorUrlWithLang('https://editor.3speak.tv/?mode=ads&lang=fr', 'ja')).toBe('https://editor.3speak.tv/?mode=ads&lang=ja')
    expect(editorUrlWithLang('https://editor.3speak.tv', 'es')).toBe('https://editor.3speak.tv?lang=es')
    expect(editorUrlWithLang('https://editor.3speak.tv?compact=true', null)).toBe('https://editor.3speak.tv?compact=true')
  })
})

describe('useEditorLanguage', () => {
  it('sends the language once the editor is ready, and every switch after', async () => {
    await act(() => i18n.changeLanguage('de'))
    const send = vi.fn()
    const { result, rerender } = renderHook(({ ready }) => useEditorLanguage(send, ready), { initialProps: { ready: false } })
    expect(result.current).toBe('de')
    expect(send).not.toHaveBeenCalled()
    rerender({ ready: true })
    expect(send).toHaveBeenCalledWith({ type: 'set-language', lang: 'de' })
    rerender({ ready: true })
    expect(send).toHaveBeenCalledTimes(1)
    await act(() => i18n.changeLanguage('ja'))
    expect(send).toHaveBeenLastCalledWith({ type: 'set-language', lang: 'ja' })
    expect(result.current).toBe('ja')
    // a reopened editor (ready again) is told again
    rerender({ ready: false })
    rerender({ ready: true })
    expect(send).toHaveBeenCalledTimes(3)
  })
})
