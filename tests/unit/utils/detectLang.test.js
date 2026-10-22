// Teleprompter script language detection (src/utils/detectLang.js).
import { describe, it, expect } from 'vitest'
import detectScriptLang, { modelIdToTag } from '../../../src/utils/detectLang.js'

describe('detectScriptLang', () => {
  it('identifies non-Latin scripts by their characters', () => {
    expect(detectScriptLang('Привет всем, это мой новый видеоролик')).toBe('ru-RU')
    expect(detectScriptLang('مرحبا بكم في هذا الفيديو الجديد')).toBe('ar-SA')
    expect(detectScriptLang('नमस्ते दोस्तों आज का वीडियो')).toBe('hi-IN')
    expect(detectScriptLang('今日はとても良い天気ですね')).toBe('ja-JP')
    expect(detectScriptLang('안녕하세요 여러분 오늘의 영상')).toBe('ko-KR')
    expect(detectScriptLang('大家好欢迎来到我的频道')).toBe('zh-CN')
  })

  it('identifies Latin-script languages by their common words', () => {
    expect(detectScriptLang('The point of this video is that we have to talk about it')).toBe('en-US')
    expect(detectScriptLang('Ich habe das nicht gewusst und wir sind auf dem Weg')).toBe('de-DE')
    expect(detectScriptLang('El perro de la casa es muy grande y los niños juegan en el parque')).toBe('es-ES')
    expect(detectScriptLang('Je pense que nous sommes dans le bon chemin avec les amis')).toBe('fr-FR')
    expect(detectScriptLang('Ik denk dat het niet een goed idee is voor ons')).toBe('nl-NL')
  })

  it('falls back to English for short or unclear text', () => {
    expect(detectScriptLang('')).toBe('en-US')
    expect(detectScriptLang(null)).toBe('en-US')
    expect(detectScriptLang('Hola!')).toBe('en-US')
    expect(detectScriptLang('Supercalifragilistic expialidocious')).toBe('en-US')
    expect(detectScriptLang('Lorem ipsum dolor sit amet consectetur adipiscing elit')).toBe('en-US')
  })

  it('only answers with a language the recognizer supports', () => {
    expect(detectScriptLang('Привет всем, это мой новый видеоролик', { allowed: ['en-US', 'de-DE'] })).toBe('en-US')
    expect(detectScriptLang('Ich habe das nicht gewusst und wir sind auf dem Weg', { allowed: ['en-US'] })).toBe('en-US')
    expect(detectScriptLang('Ich habe das nicht gewusst und wir sind auf dem Weg', { allowed: ['de-DE', 'en-US'] })).toBe('de-DE')
  })

  it('falls back to the first allowed language when English is not available', () => {
    expect(detectScriptLang('short', { allowed: ['fr-FR', 'de-DE'] })).toBe('fr-FR')
    expect(detectScriptLang('Привет всем, это мой новый видеоролик', { allowed: ['es-ES'] })).toBe('es-ES')
  })

  it('treats an empty allowed list as no restriction', () => {
    expect(detectScriptLang('Привет всем, это мой новый видеоролик', { allowed: [] })).toBe('ru-RU')
  })
})

describe('modelIdToTag', () => {
  it('turns model ids into BCP-47 tags', () => {
    expect(modelIdToTag('en-us')).toBe('en-US')
    expect(modelIdToTag('pt_br')).toBe('pt-BR')
    expect(modelIdToTag('de')).toBe('de-DE')
    expect(modelIdToTag('cn')).toBe('zh-CN')
    expect(modelIdToTag(' EN ')).toBe('en-US')
    expect(modelIdToTag('uk')).toBe('uk-UK')
    expect(modelIdToTag('')).toBe('')
    expect(modelIdToTag(null)).toBe('')
  })
})
