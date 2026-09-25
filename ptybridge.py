#!/usr/bin/env python3
"""Ponte de terminal do Cockpit.

Abre um terminal de verdade (pty) para o comando pedido e liga esse terminal
na entrada e na saida deste processo. Assim o Cockpit roda coisas interativas
(login, escolher opcao, colar codigo) dentro do proprio app, sem precisar
abrir o Terminal do Mac.

uso: ptybridge.py <colunas> <linhas> <comando...>
fd 3 (se existir): canal de controle, aceita linhas "resize <colunas> <linhas>"
"""
import os
import sys
import select
import signal
import subprocess
import time
import struct
import fcntl
import termios


def set_size(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    except Exception:
        pass


def grupos_da_sessao(sid):
    """Acha o grupo (pgid) de TODO processo vivo preso na mesma sessao do
    terminal (sid = pid de quem o forkpty criou, que sempre vira lider de
    sessao nova). Um `comando &` digitado num shell interativo ganha um
    GRUPO NOVO por causa do controle de job do shell, mas continua na MESMA
    sessao -- so olhar o grupo de 'pid' deixava esse job de fora.
    """
    grupos = set()
    try:
        saida = subprocess.run(['ps', '-Ao', 'pid=,pgid='],
                                capture_output=True, text=True, timeout=1).stdout
    except Exception:
        return grupos
    for linha in saida.splitlines():
        partes = linha.split()
        if len(partes) != 2:
            continue
        try:
            p, g = int(partes[0]), int(partes[1])
            if os.getsid(p) == sid:
                grupos.add(g)
        except Exception:
            continue
    return grupos


def sinalizar_sessao(pid, sinal):
    """Manda o sinal pra sessao inteira do comando (todo grupo dela), nunca
    para o nosso. Se por algum motivo nao achar ninguem pela sessao, cai pro
    grupo do proprio 'pid' (jeito antigo) pra nao ficar sem mandar nada.
    """
    grupos = grupos_da_sessao(pid)
    if not grupos:
        try:
            grupos = {os.getpgid(pid)}
        except Exception:
            grupos = set()
    nosso = os.getpgrp()
    for grupo in grupos:
        if grupo == nosso:
            continue
        try:
            os.killpg(grupo, sinal)
        except Exception:
            pass


def encerrar_filho(pid):
    """Fecha o comando do terminal -- e qualquer job em 2o plano que ele
    tenha aberto na mesma sessao -- e devolve o codigo de saida do comando
    principal.

    Primeiro pede pra sessao inteira sair (SIGHUP). Espera ate 1,5 s o
    comando principal sair. Sai ele ou nao a tempo, confere de novo quem
    sobrou na sessao e manda SIGKILL neles: sem essa segunda checagem, um
    job com `trap '' HUP` (ou soh mais lento) ficava orfao escondido mesmo
    com o terminal ja fechado, porque o comando principal costuma morrer do
    SIGHUP quase na hora -- antes do relogio de 1,5 s valer alguma coisa
    pros outros da sessao.
    """
    sinalizar_sessao(pid, signal.SIGHUP)
    limite = time.time() + 1.5
    status = None
    while True:
        try:
            morto, st = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            morto, st = pid, 0
        if morto == pid:
            status = st
            break
        if time.time() > limite:
            break
        time.sleep(0.05)
    if status is None:
        sinalizar_sessao(pid, signal.SIGKILL)
        try:
            _, status = os.waitpid(pid, 0)
        except Exception:
            status = 0
    if grupos_da_sessao(pid):
        sinalizar_sessao(pid, signal.SIGKILL)
    return os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else 0


def main():
    if len(sys.argv) < 4:
        sys.stderr.write('uso: ptybridge.py <colunas> <linhas> <comando...>\n')
        return 2
    cols = max(20, min(500, int(sys.argv[1])))
    rows = max(5, min(300, int(sys.argv[2])))
    cmd = sys.argv[3:]

    # Conferir ANTES do forkpty: sem canal extra, o terminal recebe justamente
    # o descritor 3. Confundi-lo com o controle colocava a mesma saída duas
    # vezes no select e travava a segunda leitura, impedindo qualquer digitação.
    ctrl = 3
    try:
        os.fstat(ctrl)
    except OSError:
        ctrl = None

    pid, master = os.forkpty()
    if pid == 0:
        os.environ['TERM'] = os.environ.get('TERM', 'xterm-256color')
        os.environ['COLUMNS'] = str(cols)
        os.environ['LINES'] = str(rows)
        try:
            os.execvp(cmd[0], cmd)
        except Exception as e:
            sys.stderr.write('nao consegui rodar: %s\n' % e)
            os._exit(127)

    set_size(master, cols, rows)

    # fd 3 = canal de controle, so existe se quem chamou criou
    ctrl_buf = b''

    fontes = [master, 0] + ([ctrl] if ctrl is not None else [])
    vivo = True
    while vivo:
        # o Cockpit morreu de vez (Forcar a Sair, travada, kill -9)? Quem perde
        # o pai passa a ser filho do launchd (pid 1). Sem ele a ponte nao serve
        # para nada: sai e leva o comando junto, em vez de ficar comendo memoria.
        if os.getppid() == 1:
            break
        try:
            prontos, _, _ = select.select(fontes, [], [], 0.2)
        except (InterruptedError, OSError):
            break

        for f in prontos:
            if f == master:
                try:
                    dados = os.read(master, 65536)
                except OSError:
                    dados = b''
                if not dados:
                    vivo = False
                    break
                try:
                    os.write(1, dados)
                except OSError:
                    # ninguem mais do outro lado para ler: fechar tudo
                    vivo = False
                    break
            elif f == 0:
                try:
                    dados = os.read(0, 65536)
                except OSError:
                    dados = b''
                if not dados:
                    # o Cockpit fechou nossa entrada (ou morreu): sem ele nao
                    # tem quem digite nem quem leia. Encerrar o comando junto.
                    vivo = False
                    break
                try:
                    os.write(master, dados)
                except OSError:
                    vivo = False
                    break
            elif ctrl is not None and f == ctrl:
                try:
                    dados = os.read(ctrl, 4096)
                except OSError:
                    dados = b''
                if not dados:
                    fontes = [x for x in fontes if x != ctrl]
                    ctrl = None
                    continue
                ctrl_buf += dados
                while b'\n' in ctrl_buf:
                    linha, ctrl_buf = ctrl_buf.split(b'\n', 1)
                    partes = linha.decode('utf8', 'ignore').split()
                    if len(partes) == 3 and partes[0] == 'resize':
                        try:
                            set_size(master, int(partes[1]), int(partes[2]))
                            os.kill(pid, signal.SIGWINCH)
                        except Exception:
                            pass

        # o filho terminou?
        try:
            fim, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            break
        if fim == pid:
            # esvazia o que sobrou na tela antes de sair
            while True:
                try:
                    resto = os.read(master, 65536)
                except OSError:
                    break
                if not resto:
                    break
                os.write(1, resto)
            return os.waitstatus_to_exitcode(status) if hasattr(os, 'waitstatus_to_exitcode') else 0

    return encerrar_filho(pid)


if __name__ == '__main__':
    sys.exit(main())
