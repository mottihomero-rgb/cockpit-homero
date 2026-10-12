// ditado-vivo.swift — ditado ao vivo para o Cockpit (macOS 26, motor nativo da Apple)
//
// Compilar:  swiftc -O ditado-vivo.swift -o ditado-vivo
// Usar:      ./ditado-vivo pt-BR 1.8 120 12
//              arg1 = idioma  arg2 = seg de silencio p/ parar  arg3 = teto em seg
//              arg4 = carencia: espera ANTES da primeira palavra (o silencio so conta depois dela)
// Parar na mao: escrever "stop" no stdin.
// Saida: uma linha JSON por evento, no stdout:
//   {"type":"status","msg":"microfone","dispositivo":"...","outros":["Zoom"]}
//                                              -> qual microfone e quem MAIS esta usando ele
//   {"type":"status","msg":"ouvindo"}          -> ja pode falar
//   {"type":"partial","text":"..."}            -> texto CINZA (ainda muda)
//   {"type":"final","text":"..."}              -> texto PRETO (fechado)
//   {"type":"error","msg":"..."}
import AppKit
import AVFoundation
import CoreAudio
import Foundation
import Speech

let T0 = Date()
let lock = NSLock()
func emit(_ o: [String: Any]) {
    var m = o; m["ms"] = Int(Date().timeIntervalSince(T0) * 1000)
    guard let d = try? JSONSerialization.data(withJSONObject: m),
          let s = String(data: d, encoding: .utf8) else { return }
    lock.lock(); print(s); fflush(stdout); lock.unlock()
}

/* ---------- quem mais esta com o microfone ----------
   O CoreAudio sabe, por processo, quem esta capturando entrada agora (macOS 14.2+). Lido ANTES
   de ligar o nosso motor; mesmo assim o nosso proprio PID, o do app pai (Cockpit) e os
   ajudantes dele ficam de fora. Servicos do sistema que escutam o tempo todo tambem. */
func endereco(_ sel: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: sel, mScope: kAudioObjectPropertyScopeGlobal,
                               mElement: kAudioObjectPropertyElementMain)
}
func lerNumero<T>(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector, _ zero: T) -> T? {
    var a = endereco(sel); var v = zero; var tam = UInt32(MemoryLayout<T>.size)
    return AudioObjectGetPropertyData(obj, &a, 0, nil, &tam, &v) == noErr ? v : nil
}
func lerTexto(_ obj: AudioObjectID, _ sel: AudioObjectPropertySelector) -> String? {
    var a = endereco(sel); var ref: Unmanaged<CFString>?; var tam = UInt32(MemoryLayout<CFString?>.size)
    guard AudioObjectGetPropertyData(obj, &a, 0, nil, &tam, &ref) == noErr, let r = ref else { return nil }
    return r.takeRetainedValue() as String
}
func microfonePadrao() -> (id: AudioObjectID, nome: String)? {
    guard let id = lerNumero(AudioObjectID(kAudioObjectSystemObject),
                             kAudioHardwarePropertyDefaultInputDevice, AudioObjectID(0)), id != 0 else { return nil }
    return (id, lerTexto(id, kAudioObjectPropertyName) ?? "microfone")
}
func quemMaisUsaMicrofone() -> [String] {
    var a = endereco(kAudioHardwarePropertyProcessObjectList); var tam: UInt32 = 0
    let sys = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(sys, &a, 0, nil, &tam) == noErr, tam > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(tam) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(sys, &a, 0, nil, &tam, &ids) == noErr else { return [] }
    let eu = getpid(), pai = getppid()
    let sistema = ["com.apple.corespeechd", "com.apple.assistant", "com.apple.siri", "com.apple.speech"]
    var nomes: [String] = []
    for o in ids {
        guard (lerNumero(o, kAudioProcessPropertyIsRunningInput, UInt32(0)) ?? 0) != 0 else { continue }
        let pid = lerNumero(o, kAudioProcessPropertyPID, pid_t(0)) ?? 0
        if pid == eu || pid == pai { continue }
        let bundle = lerTexto(o, kAudioProcessPropertyBundleID) ?? ""
        let b = bundle.lowercased()
        if b.hasPrefix("com.adsure.cockpit") || sistema.contains(where: { b.hasPrefix($0) }) { continue }
        var nome = NSRunningApplication(processIdentifier: pid)?.localizedName ?? ""
        if nome.isEmpty, !bundle.isEmpty {
            // "com.google.Chrome.helper.Renderer" -> "Chrome"
            var partes = bundle.split(separator: ".").map(String.init)
            if let i = partes.firstIndex(where: { $0.lowercased() == "helper" }), i > 0 { partes = Array(partes[..<i]) }
            nome = partes.last ?? bundle
        }
        if nome.isEmpty { nome = "processo \(pid)" }
        if !nomes.contains(nome) { nomes.append(nome) }
    }
    return nomes
}

final class Estado: @unchecked Sendable {
    private let lk = NSLock()
    private var ultimaVoz = Date()
    private var parou = false
    private var jaFalou = false
    /* Nivel do som, so GUARDADO aqui. Quem escreve e a thread de audio (tempo real): ela nao
       pode emitir nada, porque o emit faz print+fflush sob lock e travaria a captura no meio
       do buffer. Ela deixa o numero aqui; quem manda para a tela e o laco de 150ms la embaixo. */
    private var rms: Float = 0
    private var pico: Float = 0
    func porRms(_ v: Float) { lk.lock(); rms = v; if v > pico { pico = v }; lk.unlock() }
    var nivel: (Float, Float) { lk.lock(); defer { lk.unlock() }; return (rms, pico) }
    func ouviVoz() { lk.lock(); ultimaVoz = Date(); jaFalou = true; lk.unlock() }
    var caladoHa: Double { lk.lock(); defer { lk.unlock() }; return Date().timeIntervalSince(ultimaVoz) }
    var parado: Bool { lk.lock(); defer { lk.unlock() }; return parou }
    var comecou: Bool { lk.lock(); defer { lk.unlock() }; return jaFalou }
    func parar() { lk.lock(); parou = true; lk.unlock() }
}

@available(macOS 26.0, *)
func ditar(idioma: String, silencio: Double, teto: Double, carencia: Double) async {
    let est = Estado()

    // stdin: "stop" para na hora (botao do microfone)
    Thread.detachNewThread {
        while let linha = readLine(strippingNewline: true) {
            if linha.trimmingCharacters(in: .whitespaces).lowercased() == "stop" { est.parar(); return }
        }
    }

    let loc = Locale(identifier: idioma)
    let instalados = await SpeechTranscriber.installedLocales.map { $0.identifier(.bcp47) }
    guard instalados.contains(where: { $0.lowercased() == idioma.lowercased() }) else {
        emit(["type": "error", "msg": "idioma nao instalado", "instalados": instalados]); return
    }

    // .progressiveTranscription = o preset que solta texto parcial ENQUANTO fala.
    // (montar as opcoes na mao, sem preset, faz o texto so sair no fim — testado.)
    let escriba = SpeechTranscriber(locale: loc, preset: .progressiveTranscription)
    let motor = SpeechAnalyzer(modules: [escriba],
                               options: .init(priority: .userInitiated, modelRetention: .processLifetime))
    let (fila, envia) = AsyncStream<AnalyzerInput>.makeStream()

    guard let alvo = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [escriba]) else {
        emit(["type": "error", "msg": "sem formato de audio"]); return
    }
    let engine = AVAudioEngine()
    let entrada = engine.inputNode
    let fmtMic = entrada.outputFormat(forBus: 0)
    guard let conv = AVAudioConverter(from: fmtMic, to: alvo) else {
        emit(["type": "error", "msg": "sem conversor de audio"]); return
    }
    let razao = alvo.sampleRate / fmtMic.sampleRate

    // consumidor dos resultados: Task propria, ligada ANTES do audio comecar
    let leitor = Task {
        do {
            for try await r in escriba.results {
                emit(["type": r.isFinal ? "final" : "partial", "text": String(r.text.characters)])
            }
        } catch { emit(["type": "error", "msg": "\(error)"]) }
    }

    do { try await motor.start(inputSequence: fila) }
    catch { emit(["type": "error", "msg": "start: \(error)"]); return }

    entrada.installTap(onBus: 0, bufferSize: 2048, format: fmtMic) { buf, _ in
        var rms: Float = 0
        if let ch = buf.floatChannelData?[0] {
            let n = Int(buf.frameLength); var s: Float = 0
            for i in 0..<n { s += ch[i] * ch[i] }
            rms = (s / Float(max(n, 1))).squareRoot()
        }
        if rms > 0.010 { est.ouviVoz() }              // limiar de voz; subir se o ambiente for barulhento
        est.porRms(rms)                               // so guarda (lock e atribuicao); quem emite e o laco
        let cap = AVAudioFrameCount(Double(buf.frameLength) * razao + 1024)
        guard let saida = AVAudioPCMBuffer(pcmFormat: alvo, frameCapacity: cap) else { return }
        var err: NSError?; var deu = false
        conv.convert(to: saida, error: &err) { _, st in
            if deu { st.pointee = .noDataNow; return nil }
            deu = true; st.pointee = .haveData; return buf
        }
        if err == nil { envia.yield(AnalyzerInput(buffer: saida)) }
    }

    // diz qual microfone vai ouvir e se mais alguem esta nele (a tela avisa; nao bloqueia)
    var info: [String: Any] = ["type": "status", "msg": "microfone", "outros": quemMaisUsaMicrofone()]
    if let m = microfonePadrao() { info["dispositivo"] = m.nome }
    emit(info)

    engine.prepare()
    do { try engine.start() } catch { emit(["type": "error", "msg": "microfone: \(error)"]); return }
    emit(["type": "status", "msg": "ouvindo"])

    /* O corte por silencio so vale DEPOIS que ele falou a primeira vez. Sem isto, quem aperta o
       microfone e leva tres segundos para comecar a falar via o ditado morrer sozinho antes de
       dizer a primeira palavra — foi o que aconteceu no primeiro teste. Antes da primeira voz
       vale a carencia: espera longa, e so entao desiste. */
    while !est.parado {
        try? await Task.sleep(nanoseconds: 150_000_000)
        /* Nivel do microfone para a barrinha do botao. Sai daqui, do laco, e nunca de dentro do
           installTap: la e thread de audio em tempo real e um print travaria a captura. */
        let (nRms, nPico) = est.nivel
        emit(["type": "nivel",
              "rms": (Double(nRms) * 10000).rounded() / 10000,
              "pico": (Double(nPico) * 10000).rounded() / 10000])
        if est.comecou {
            if est.caladoHa > silencio { emit(["type": "status", "msg": "silencio"]); break }
        } else if Date().timeIntervalSince(T0) > carencia {
            emit(["type": "status", "msg": "nao ouvi nada"]); break
        }
        if Date().timeIntervalSince(T0) > teto { emit(["type": "status", "msg": "teto de tempo"]); break }
    }

    entrada.removeTap(onBus: 0)
    engine.stop()
    envia.finish()

    // Fechar o motor TRAVA quando nao houve fala nenhuma (testado: fica preso pra sempre).
    // Nao da para esperar por ele: espera no maximo 2s e sai na marra.
    let pronto = Estado()
    let fecho = Task {
        try? await motor.finalizeAndFinishThroughEndOfInput()
        _ = await leitor.result
        pronto.parar()
    }
    var esperei = 0.0
    while !pronto.parado && esperei < 2.0 {
        try? await Task.sleep(nanoseconds: 100_000_000); esperei += 0.1
    }
    fecho.cancel(); leitor.cancel()
    emit(["type": "status", "msg": "fim"])
    exit(0)   // mata inclusive o fecho travado
}

@available(macOS 26.0, *)
func inicio() async {
    let a = CommandLine.arguments
    let idioma = a.count > 1 ? a[1] : "pt-BR"
    let silencio = a.count > 2 ? (Double(a[2]) ?? 1.8) : 1.8
    let teto = a.count > 3 ? (Double(a[3]) ?? 120) : 120
    let carencia = a.count > 4 ? (Double(a[4]) ?? 12) : 12
    let ok = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
        AVCaptureDevice.requestAccess(for: .audio) { c.resume(returning: $0) }
    }
    guard ok else {
        emit(["type": "error", "msg": "sem permissao de microfone"]); return
    }
    await ditar(idioma: idioma, silencio: silencio, teto: teto, carencia: carencia)
}

if #available(macOS 26.0, *) { await inicio() }
else { emit(["type": "error", "msg": "precisa de macOS 26 ou mais novo"]) }
