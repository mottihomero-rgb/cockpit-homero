/* ============ estado global ============ */
let cfg = {}, HOME = '';
let paneSeq = 0, focusPane = null;
/* O iPhone roda este MESMO arquivo e fala com o MESMO processo principal do Mac. Como os dois
   contavam do zero, os dois criavam "p1", "p2"... e o telefone acabava mandando parar (ou
   religar) o chat que estava rodando no Mac. Um prefixo diferente por tela resolve. Estes ids
   nao sao gravados no config — sao so para esta sessao — entao mudar o formato e seguro.
   No Mac o prefixo fica VAZIO de proposito: os ids continuam p1, p2, t1... como sempre foram,
   e por isso recarregar a janela reaproveita os mesmos ids e o processo principal nao fica com
   chat e terminal orfaos rodando escondidos. Quem ganha prefixo e o telefone. */
const ESTA_TELA = (typeof window !== 'undefined' && window.SEM_ELECTRON)
  ? ('w' + Math.random().toString(36).slice(2, 7))
  : '';
const panes = new Map();     // id -> objeto do painel
const motoresTrocandoConta = new Set();
// cada ABA e uma pasta de projeto; dentro dela ficam os chats lado a lado
let abaSeq = 0, abaAtiva = null;
const abas = new Map();      // aid -> { id, cwd, el, corpoEl, ordem: [paneId], ativo }

const $ = (s, r = document) => r.querySelector(s);
/* logos oficiais (simple-icons) */
const LOGO = {
  claude: 'M4.7144 15.9555l4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  codex: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
};
// leva 12: plugue do ACP (protocolo aberto, sem marca de ninguém): dois pinos, corpo e cabo
LOGO.acp = 'M9 2h2v5h2V2h2v5h2a1 1 0 0 1 1 1v3a6 6 0 0 1-5 5.92V22h-2v-5.08A6 6 0 0 1 6 11V8a1 1 0 0 1 1-1h2V2z';

// Vetores oficiais, guardados em renderer/logos/. Sem buscar imagens pela rede.
const LOGOS_MARCA = {
  "gemini": {
    "viewBox": "0 0 65 65",
    "conteudo": "<path d=\"M57.8647 29.0109C52.865 26.8587 48.4905 23.9061 44.7393 20.1567C40.99 16.4074 38.0373 12.031 35.8851 7.03132C35.0589 5.11516 34.395 3.14552 33.886 1.12608C33.72 0.465846 33.128 0.00109863 32.4475 0.00109863C31.7669 0.00109863 31.1749 0.465846 31.009 1.12608C30.4999 3.14552 29.836 5.11332 29.0098 7.03132C26.8576 12.031 23.905 16.4074 20.1556 20.1567C16.4063 23.9061 12.0299 26.8587 7.03022 29.0109C5.11406 29.8371 3.14442 30.501 1.12498 31.0101C0.464747 31.176 0 31.768 0 32.4486C0 33.1291 0.464747 33.7211 1.12498 33.8871C3.14442 34.3961 5.11222 35.06 7.03022 35.8862C12.0299 38.0384 16.4045 40.9911 20.1556 44.7404C23.9068 48.4897 26.8576 52.8661 29.0098 57.8658C29.836 59.782 30.4999 61.7516 31.009 63.771C31.1749 64.4313 31.7669 64.896 32.4475 64.896C33.128 64.896 33.72 64.4313 33.886 63.771C34.395 61.7516 35.0589 59.7838 35.8851 57.8658C38.0373 52.8661 40.99 48.4916 44.7393 44.7404C48.4886 40.9911 52.865 38.0384 57.8647 35.8862C59.7809 35.06 61.7505 34.3961 63.7699 33.8871C64.4302 33.7211 64.8949 33.1291 64.8949 32.4486C64.8949 31.768 64.4302 31.176 63.7699 31.0101C61.7505 30.501 59.7827 29.8371 57.8647 29.0109Z\" fill=\"white\" /><mask id=\"cockpit-gemini-mask0_10859_4895\" style=\"mask-type:alpha\" maskUnits=\"userSpaceOnUse\" x=\"0\" y=\"0\" width=\"65\" height=\"65\"><path d=\"M32.4473 0C33.1278 0 33.7197 0.464783 33.8857 1.125C34.3947 3.14441 35.0586 5.11414 35.8848 7.03027C38.0369 12.0299 40.99 16.406 44.7393 20.1553C48.4903 23.9045 52.8647 26.8576 57.8643 29.0098C59.7821 29.8359 61.7502 30.4998 63.7695 31.0088C64.4297 31.1748 64.8944 31.7668 64.8945 32.4473C64.8945 33.1278 64.4298 33.7198 63.7695 33.8857C61.7502 34.3947 59.7803 35.0586 57.8643 35.8848C52.8646 38.037 48.4885 40.99 44.7393 44.7393C40.99 48.4904 38.037 52.8646 35.8848 57.8643C35.0586 59.7822 34.3947 61.7502 33.8857 63.7695C33.7198 64.4298 33.1278 64.8945 32.4473 64.8945C31.7668 64.8944 31.1748 64.4297 31.0088 63.7695C30.4998 61.7502 29.8359 59.7803 29.0098 57.8643C26.8576 52.8647 23.9063 48.4885 20.1553 44.7393C16.4041 40.99 12.0299 38.0369 7.03027 35.8848C5.1123 35.0586 3.14441 34.3947 1.125 33.8857C0.464783 33.7197 0 33.1278 0 32.4473C8.67651e-05 31.7668 0.464826 31.1748 1.125 31.0088C3.14442 30.4998 5.11413 29.836 7.03027 29.0098C12.03 26.8575 16.406 23.9046 20.1553 20.1553C23.9046 16.406 26.8575 12.03 29.0098 7.03027C29.836 5.11229 30.4998 3.14442 31.0088 1.125C31.1748 0.464826 31.7668 8.67651e-05 32.4473 0Z\" fill=\"black\" /><path d=\"M32.4473 0C33.1278 0 33.7197 0.464783 33.8857 1.125C34.3947 3.14441 35.0586 5.11414 35.8848 7.03027C38.0369 12.0299 40.99 16.406 44.7393 20.1553C48.4903 23.9045 52.8647 26.8576 57.8643 29.0098C59.7821 29.8359 61.7502 30.4998 63.7695 31.0088C64.4297 31.1748 64.8944 31.7668 64.8945 32.4473C64.8945 33.1278 64.4298 33.7198 63.7695 33.8857C61.7502 34.3947 59.7803 35.0586 57.8643 35.8848C52.8646 38.037 48.4885 40.99 44.7393 44.7393C40.99 48.4904 38.037 52.8646 35.8848 57.8643C35.0586 59.7822 34.3947 61.7502 33.8857 63.7695C33.7198 64.4298 33.1278 64.8945 32.4473 64.8945C31.7668 64.8944 31.1748 64.4297 31.0088 63.7695C30.4998 61.7502 29.8359 59.7803 29.0098 57.8643C26.8576 52.8647 23.9063 48.4885 20.1553 44.7393C16.4041 40.99 12.0299 38.0369 7.03027 35.8848C5.1123 35.0586 3.14441 34.3947 1.125 33.8857C0.464783 33.7197 0 33.1278 0 32.4473C8.67651e-05 31.7668 0.464826 31.1748 1.125 31.0088C3.14442 30.4998 5.11413 29.836 7.03027 29.0098C12.03 26.8575 16.406 23.9046 20.1553 20.1553C23.9046 16.406 26.8575 12.03 29.0098 7.03027C29.836 5.11229 30.4998 3.14442 31.0088 1.125C31.1748 0.464826 31.7668 8.67651e-05 32.4473 0Z\" fill=\"url(#cockpit-gemini-paint0_linear_10859_4895)\" /></mask><g mask=\"url(#cockpit-gemini-mask0_10859_4895)\"><g filter=\"url(#cockpit-gemini-filter0_f_10859_4895)\"><ellipse cx=\"14.4072\" cy=\"16.9504\" rx=\"14.4072\" ry=\"16.9504\" transform=\"matrix(0.942341 0.334654 -0.334652 0.942342 -8.09058 13.9664)\" fill=\"#FFE432\" /></g><g filter=\"url(#cockpit-gemini-filter1_f_10859_4895)\"><ellipse cx=\"27.4329\" cy=\"2.5869\" rx=\"18.6516\" ry=\"19.0617\" fill=\"#FC413D\" /></g><g filter=\"url(#cockpit-gemini-filter2_f_10859_4895)\"><ellipse cx=\"18.9512\" cy=\"57.3856\" rx=\"19.4934\" ry=\"25.2529\" transform=\"rotate(-2.79865 18.9512 57.3856)\" fill=\"#00B95C\" /></g><g filter=\"url(#cockpit-gemini-filter3_f_10859_4895)\"><ellipse cx=\"18.9512\" cy=\"57.3856\" rx=\"19.4934\" ry=\"25.2529\" transform=\"rotate(-2.79865 18.9512 57.3856)\" fill=\"#00B95C\" /></g><g filter=\"url(#cockpit-gemini-filter4_f_10859_4895)\"><ellipse cx=\"20.0204\" cy=\"56.2114\" rx=\"19.1065\" ry=\"21.0345\" transform=\"rotate(-31.3178 20.0204 56.2114)\" fill=\"#00B95C\" /></g><g filter=\"url(#cockpit-gemini-filter5_f_10859_4895)\"><ellipse cx=\"67.391\" cy=\"25.3267\" rx=\"18.3463\" ry=\"17.6668\" fill=\"#3186FF\" /></g><g filter=\"url(#cockpit-gemini-filter6_f_10859_4895)\"><ellipse cx=\"21.222\" cy=\"22.3842\" rx=\"21.222\" ry=\"22.3842\" transform=\"matrix(0.795985 0.605316 -0.605314 0.795987 -2.85815 -7.53723)\" fill=\"#FBBC04\" /></g><g filter=\"url(#cockpit-gemini-filter7_f_10859_4895)\"><ellipse cx=\"24.4687\" cy=\"22.6039\" rx=\"24.4687\" ry=\"22.6039\" transform=\"matrix(0.824033 0.566542 -0.566539 0.824035 40.1882 0.315002)\" fill=\"#3186FF\" /></g><g filter=\"url(#cockpit-gemini-filter8_f_10859_4895)\"><path d=\"M54.9838 -2.33625C57.8168 1.51558 54.1765 9.00477 46.8529 14.3913C39.5293 19.7779 31.2957 21.022 28.4627 17.1702C25.6296 13.3184 29.27 5.82919 36.5935 0.442635C43.9171 -4.94392 52.1507 -6.18807 54.9838 -2.33625Z\" fill=\"#749BFF\" /></g><g filter=\"url(#cockpit-gemini-filter9_f_10859_4895)\"><ellipse cx=\"19.9023\" cy=\"3.35597\" rx=\"27.9712\" ry=\"17.3877\" transform=\"rotate(-42.848 19.9023 3.35597)\" fill=\"#FC413D\" /></g><g filter=\"url(#cockpit-gemini-filter10_f_10859_4895)\"><ellipse cx=\"13.5831\" cy=\"46.7501\" rx=\"14.9887\" ry=\"8.71667\" transform=\"rotate(35.592 13.5831 46.7501)\" fill=\"#FFEE48\" /></g></g><defs><filter id=\"cockpit-gemini-filter0_f_10859_4895\" x=\"-19.8236\" y=\"13.1523\" width=\"39.2739\" height=\"43.2171\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"2.45965\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter1_f_10859_4895\" x=\"-15.001\" y=\"-40.257\" width=\"84.8677\" height=\"85.6878\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"11.8911\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter2_f_10859_4895\" x=\"-20.7758\" y=\"11.9273\" width=\"79.454\" height=\"90.9166\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"10.1086\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter3_f_10859_4895\" x=\"-20.7758\" y=\"11.9273\" width=\"79.454\" height=\"90.9166\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"10.1086\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter4_f_10859_4895\" x=\"-19.8449\" y=\"15.459\" width=\"79.7306\" height=\"81.5048\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"10.1086\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter5_f_10859_4895\" x=\"29.8324\" y=\"-11.5524\" width=\"75.1172\" height=\"73.7582\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"9.60613\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter6_f_10859_4895\" x=\"-38.5827\" y=\"-16.2526\" width=\"78.1352\" height=\"78.7578\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"8.70591\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter7_f_10859_4895\" x=\"8.1068\" y=\"-5.96578\" width=\"78.877\" height=\"77.5394\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"7.77473\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter8_f_10859_4895\" x=\"13.5873\" y=\"-18.4881\" width=\"56.2718\" height=\"51.8102\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"6.95694\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter9_f_10859_4895\" x=\"-15.5259\" y=\"-31.297\" width=\"70.8565\" height=\"69.3059\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"5.87598\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><filter id=\"cockpit-gemini-filter10_f_10859_4895\" x=\"-14.1676\" y=\"20.9644\" width=\"55.5015\" height=\"51.5714\" filterUnits=\"userSpaceOnUse\" color-interpolation-filters=\"sRGB\"><feFlood flood-opacity=\"0\" result=\"BackgroundImageFix\" /><feBlend mode=\"normal\" in=\"SourceGraphic\" in2=\"BackgroundImageFix\" result=\"shape\" /><feGaussianBlur stdDeviation=\"7.27253\" result=\"effect1_foregroundBlur_10859_4895\" /></filter><linearGradient id=\"cockpit-gemini-paint0_linear_10859_4895\" x1=\"18.4474\" y1=\"43.4202\" x2=\"52.1528\" y2=\"15.0035\" gradientUnits=\"userSpaceOnUse\"><stop stop-color=\"#4893FC\" /><stop offset=\"0.27\" stop-color=\"#4893FC\" /><stop offset=\"0.776981\" stop-color=\"#969DFF\" /><stop offset=\"1\" stop-color=\"#BD99FE\" /></linearGradient></defs>"
  },
  "grok": {
    "viewBox": "56 56 400 400",
    "conteudo": "<path d=\"M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794\" /><path d=\"M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677\" />"
  }
};
/* Ícones: os desenhos agora são os do redesenho (renderer/icones.js, grade de 16, traço 1,4).
   Este mapa só traduz o NOME que o app sempre usou para o desenho novo — assim nenhum ponto do
   app precisou mudar de nome. Os que o handoff não tinha foram desenhados no mesmo estilo lá no
   icones.js. Ex.: 'hand' (modo Manual) virou o cadeado fechado porque no redesenho cadeado
   fechado = "pede permissão" e aberto = "sem pedir".
   Nome que não está aqui cai direto no icones.js (ico('xmark') também funciona). */
const ICONE_NOVO = {
  'x': 'xmark', 'plus': 'plus', 'minus': 'minus', 'check': 'check', 'circle': 'circle',
  'chevron-down': 'chevron-down', 'chevron-right': 'chevron-right', 'arrow-up': 'arrow-up',
  'pencil': 'pencil', 'copy': 'copy', 'search': 'search', 'eraser': 'eraser', 'mic': 'mic',
  'folder': 'folder', 'folder-open': 'folder-open', 'file': 'doc', 'file-code': 'doc-code',
  'file-text': 'doc-text', 'braces': 'braces', 'image': 'photo', 'terminal': 'terminal',
  'hand': 'lock', 'lock': 'lock', 'unlock': 'lock-open', 'code-xml': 'code', 'clipboard-list': 'plan',
  'zap': 'bolt', 'sparkles': 'sparkles', 'brain': 'brain', 'sliders-horizontal': 'sliders',
  'arrow-left-right': 'arrows-lr', 'user': 'person', 'upload': 'upload', 'map-pin': 'pin',
  'refresh-cw': 'retry', 'rotate-cw': 'retry', 'panel-left': 'sidebar', 'columns-2': 'columns',
  'plug': 'plug', 'book': 'book', 'star': 'star', 'server': 'server', 'key-round': 'key',
  'log-out': 'log-out', 'circle-help': 'question', 'square': 'stop', 'agentes': 'team',
  'quadro': 'board', 'crop': 'crop', 'camera': 'camera', 'git-branch': 'branch',
};
// sem o icones.js carregado (os testes rodam o app.js solto) os ícones saem vazios, sem quebrar
const CK_TRACOS = (typeof window !== 'undefined' && window.CK_ICONES) || {};
const ICONES = {};
for (const [velho, novo] of Object.entries(ICONE_NOVO)) ICONES[velho] = CK_TRACOS[novo] || '';
const ico = (n) => '<svg viewBox="0 0 16 16" class="ic" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONES[n] || CK_TRACOS[n] || '') + '</svg>';
let logoMotorSeq = 0;
function conteudoLogoMotor(eng) {
  const marca = LOGOS_MARCA[eng];
  // Máscaras e filtros do Gemini precisam de IDs únicos em cada lugar da tela.
  return marca ? marca.conteudo.replaceAll('cockpit-gemini-', 'cockpit-gemini-' + (++logoMotorSeq) + '-')
    : '<path d="' + (LOGO[eng] || LOGO.claude) + '"/>';
}
const svgMotor = (eng) => '<svg viewBox="' + (LOGOS_MARCA[eng]?.viewBox || '0 0 24 24')
  + '" class="logo-motor" aria-hidden="true">' + conteudoLogoMotor(eng) + '</svg>';
/* leva 12.4: um lugar só para o nome e para a caixa lateral de cada motor. Antes cada ponto
   escrevia à mão `engine === 'claude' ? '#histClaude' : '#histCodex'` — ou seja, QUALQUER motor
   que não fosse o Claude escrevia na coluna do Codex, e o ACP APAGARIA a lista do Codex. */
const NOME_MOTOR = { claude: 'Claude', codex: 'Codex', acp: 'ACP', gemini: 'Gemini', grok: 'Grok' };
const nomeDoMotor = (eng) => NOME_MOTOR[eng] || 'Claude';
const MOTORES = ['claude', 'codex', 'acp', 'gemini', 'grok'];
// ACP continua no histórico antigo; as escolhas novas são marcas, não protocolos.
const MOTORES_VISIVEIS = ['claude', 'codex', 'gemini', 'grok'];
// sem motor salvo (1º boot ou config resetado), o padrão é Claude, não Codex.
const motorVisivel = (eng) => MOTORES_VISIVEIS.includes(eng) ? eng : 'claude';
const CAIXA_MOTOR = { claude: 'Claude', codex: 'Codex', acp: 'Acp', gemini: 'Gemini', grok: 'Grok' };
/* 25/09: a coluna de conversas e UMA so, com todas as IAs juntas. Qualquer motor escreve na
   mesma caixa — e a lista que ela mostra e montada por pintarConversas(), nunca por motor. */
const VISTA_CONVERSAS = 'todas';
const caixaHist = () => document.getElementById('histTodas');
/* estado guardado por motor: nascendo com os três, um "++" numa chave que não existe deixa de
   virar NaN — que é o que faria a lista do ACP nunca pintar */
const porMotor = (valor) => { const o = {}; for (const m of MOTORES) o[m] = valor; return o; };
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// Resposta de IA e de conectores é conteúdo externo. HTML bruto nunca entra na janela.
const markdownSeguro = new marked.Renderer();
const escaparAtributo = (v) => String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
markdownSeguro.html = () => '';
/* Link para arquivo do Mac vira link de ARQUIVO. Antes todo link que nao fosse http virava so o
   texto: o Codex entregava "[Baixar arte](/Users/.../arte.png)" e a entrega sumia da conversa,
   sem link, sem imagem e sem caminho. Aqui so marca o caminho; quem liga o clique e a
   miniatura e o linkarArquivos, que sabe de qual painel (Mac ou VPS) a fala veio. */
const caminhoDoLink = (href) => {
  let h = String(href || '').trim();
  if (/^file:\/\//i.test(h)) h = h.replace(/^file:\/\//i, '');
  if (!h.startsWith('/') || h.startsWith('//')) return '';
  try { h = decodeURIComponent(h); } catch {}
  return h;
};
const linkDeArquivo = (caminho, text, img) => '<a class="arquivo" href="#" data-caminho="' + escaparAtributo(caminho) + '"'
  + (img ? ' data-img="1"' : '') + '>' + (text || escaparAtributo(caminho.split('/').pop())) + '</a>';
markdownSeguro.link = (href, title, text) => {
  const caminho = caminhoDoLink(href);
  if (caminho) return linkDeArquivo(caminho, text);
  if (!/^https?:\/\//i.test(String(href || ''))) return text;
  return '<a href="' + escaparAtributo(href) + '"' + (title ? ' title="' + escaparAtributo(title) + '"' : '') + '>' + text + '</a>';
};
markdownSeguro.image = (href, _title, text) => {
  const caminho = caminhoDoLink(href);
  return caminho ? linkDeArquivo(caminho, text, true) : text;
};
marked.setOptions({ breaks: true, gfm: true, renderer: markdownSeguro });

const EF_PT = { minimal: 'Mínimo', low: 'Leve', medium: 'Médio', high: 'Alto',
  xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra' };
const EF_DESC_PT = {
  minimal: 'O mais rápido, pensa quase nada',
  low: 'Resposta rápida, raciocínio leve',
  medium: 'Equilibra velocidade e profundidade',
  high: 'Pensa mais fundo em problemas difíceis',
  xhigh: 'Raciocínio bem mais profundo',
  max: 'Profundidade máxima + vários agentes em paralelo (workflows)',
  ultra: 'Consome a cota de uso mais rápido',
};

// esforço com que TODA conversa nova nasce (não muda quando você mexe na barra de um painel)
const EF_NOVO = 'xhigh';
/* O que toda conversa NOVA do Claude e do Codex traz marcado (pedido do Homero, 15/09/2026):
   Codex no Sol, Claude no Opus 5.5 SEM o 1M, os dois no Alto (22/09/2026). Vale para aba nova, "nova
   conversa" e troca de motor no mesmo chat; conversa restaurada mantém o que estava salvo.
   Se o modelo sumir da lista do motor, cai no padrão dele (fillModels). */
const PADRAO_NOVO = {
  claude: { model: 'claude-opus-5-5', effort: 'high' },
  codex: { model: 'gpt-6-sol', effort: 'high' },
};
const modeloNovo = (eng) => (PADRAO_NOVO[eng] && PADRAO_NOVO[eng].model) || '';
const esforcoNovo = (eng) => (PADRAO_NOVO[eng] && PADRAO_NOVO[eng].effort) || EF_NOVO;

// no Máximo o painel do Claude vira "ultracode". Em --print o CLI proíbe workflow por padrão,
// então a liberação vai como fala do usuário — é o que vence a regra de fábrica (testado).
// no modo "Entra" a mensagem cai no meio do trabalho. Em vez de atropelar, ele escolhe.
const ENTRA_MSG = 'ATENÇÃO: esta mensagem chegou enquanto você já estava trabalhando em outra coisa. '
  + 'VOCÊ DECIDE o que fazer com ela, e a primeira linha da sua resposta tem que dizer qual dos dois escolheu:\n'
  + '(a) "Faço agora" — se isso muda o rumo do que você está fazendo, corrige algo errado, ou perde a validade se esperar. '
  + 'Nesse caso pare o que estava fazendo e atenda.\n'
  + '(b) "Termino o que estou fazendo e já faço" — se o que você está fazendo continua valendo. '
  + 'Nesse caso termine primeiro e, ASSIM QUE TERMINAR, faça isto sem que eu precise repetir.\n'
  + 'Não pergunte qual eu prefiro: escolha e siga.\n\n--- o que eu pedi ---\n';

const ULTRACODE_MSG = 'MODO ULTRACODE LIGADO PELO USUÁRIO: eu autorizo explicitamente, para esta e para todas as tarefas substantivas desta conversa, o uso da ferramenta Workflow (orquestração multi-agente) e de subagentes em paralelo. Busque a resposta mais completa e correta, não a mais rápida ou barata. Isso substitui qualquer regra em contrário sobre não usar workflows sem eu pedir. Continue pedindo meu aval apenas para gastar dinheiro, publicar/enviar para fora, ou apagar o que já funciona.\n\nMODELO POR TAREFA (ao delegar a subagentes ou workflow, passe sempre o parâmetro model conforme a tarefa, para economizar sem perder qualidade): use Haiku (model: "haiku") para triagem, classificação, roteamento e leituras/extrações curtas; Sonnet (model: "sonnet") para execução mecânica — escrever/editar código, produzir conteúdo, buscas amplas em arquivos; reserve Opus para o planejamento e as decisões difíceis (que você, o orquestrador, já faz). Nunca rode em Opus um subagente que só classifica ou lê.\n\n---\n\n';

const MODELOS_CLAUDE = [
  { id: 'claude-opus-5-5[1m]', nome: 'Opus 5.5 (1M)', desc: 'O mais forte de todos, com memória gigante',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'xhigh', padrao: true },
  { id: 'claude-opus-5-5', nome: 'Opus 5.5', desc: 'O mais forte de todos',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'xhigh' },
  { id: 'claude-opus-5[1m]', nome: 'Opus 5 (1M)', desc: 'A geração anterior, com memória gigante',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'xhigh' },
  // Fable 5.1 so existe do CLI 2.1.251 para cima. Com o CLI velho o modelo devolve erro 400
  // pedindo 'claude update' — o app copia a versao nova para o caminho fixo no arranque.
  { id: 'claude-fable-5-1[1m]', nome: 'Fable 5.1', desc: 'O mais novo, com memória gigante',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'xhigh' },
  { id: 'claude-fable-5', nome: 'Fable 5', desc: 'A geração anterior do Fable',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'xhigh' },
  { id: 'claude-opus-5', nome: 'Opus 5', desc: 'A geração anterior',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'xhigh' },
  { id: 'claude-sonnet-5', nome: 'Sonnet 5', desc: 'Rápido e bom para o dia a dia',
    efforts: ['low','medium','high','xhigh','max'], padraoEffort: 'xhigh' },
  { id: 'claude-haiku-4-5-20251001', nome: 'Haiku 4.5', desc: 'O mais barato e veloz',
    efforts: ['low','medium','high'], padraoEffort: 'high' },
];
let MODELOS_CODEX = null;   // vem do proprio Codex
/* O Codex manda nome e descrição em inglês ("GPT-6-Astra", "Frontier intelligence…").
   Aqui eles viram português, igual à lista do Claude. Modelo que não estiver no mapa continua
   aparecendo com o nome que o Codex mandou — nunca some da lista. (23/09/2026) */
const CODEX_PT = {
  'gpt-6-astra': { nome: 'Astra 6', desc: 'O mais forte de todos, para o trabalho mais pesado' },
  'gpt-6-sol':   { nome: 'Sol 6',   desc: 'O cavalo de batalha: código e dia a dia' },
  'gpt-6-luna':  { nome: 'Luna 6',  desc: 'Rápido e barato, para tarefas mais fáceis' },
  'gpt-5.6-sol':   { nome: 'Sol 5.6',   desc: 'A geração anterior para trabalho complexo' },
  'gpt-5.6-terra': { nome: 'Terra 5.6', desc: 'A geração anterior, equilibrada' },
  'gpt-5.6-luna':  { nome: 'Luna 5.6',  desc: 'A geração anterior, rápida e econômica' },
  'gpt-5.5':       { nome: 'GPT-5.5',   desc: 'Modelo antigo de código' },
};
const traduzCodex = (ms) => (ms || []).map((m) => {
  const pt = CODEX_PT[m.id];
  return pt ? { ...m, nome: pt.nome, desc: pt.desc } : m;
});
/* O "Astra por créditos" (chave da API da OpenAI) saiu da tela em 11/09/2026. Ninguém mais
   escolhe um modelo 'api:…', então estas duas ficam só para um painel antigo que ainda o traga
   salvo não mandar o prefixo para o Codex. */
const modeloPorCreditos = (id) => String(id || '').startsWith('api:');
const modeloSemOrigem = (id) => modeloPorCreditos(id) ? String(id).slice(4) : id;

/* leva 12.4 — no painel ACP o "modelo" é o COMANDO que sobe o agente. Cada agente que fala o
   protocolo entra por aqui: o Cockpit não precisa saber nada sobre ele além da linha de comando.
   O `desc` diz como instalar, para o menu não oferecer um agente e o painel falhar depois. */
/* leva 12.5: quais motores existem NESTA máquina (o main responde por motores:disponiveis).
   Serve para avisar ANTES, em vez de deixar o painel falhar depois da primeira mensagem. */
let MOTORES_OK = null;
const AGENTES_ACP = [
  { id: 'gemini --acp', nome: 'Gemini CLI', desc: 'npm i -g @google/gemini-cli',
    efforts: ['medium'], padraoEffort: 'medium', padrao: true, bin: 'gemini' },
  { id: 'npx -y @zed-industries/claude-code-acp', nome: 'Claude Code (adaptador do Zed)',
    desc: 'o npx baixa sozinho na primeira vez', efforts: ['medium'], padraoEffort: 'medium', bin: 'npx' },
  { id: 'qwen --acp', nome: 'Qwen Code', desc: 'npm i -g @qwen-code/qwen-code',
    efforts: ['medium'], padraoEffort: 'medium', bin: 'qwen' },
  { id: 'opencode acp', nome: 'OpenCode', desc: 'brew install sst/tap/opencode',
    efforts: ['medium'], padraoEffort: 'medium', bin: 'opencode' },
];
/* Enquanto o radar não respondeu, tudo conta como instalado: dizer "não está instalado" sem
   ter olhado seria pior do que não dizer nada. */
const agenteAcpTem = (m) => !m.bin || !MOTORES_OK || !MOTORES_OK.acpBins || !!MOTORES_OK.acpBins[m.bin];
// (quem decide o agente ACP e' o dropdown de modelos, via agenteAcpTem acima)

const MODELOS_GEMINI = [{ id: '', nome: 'Padrão do Gemini', desc: 'Usa o Gemini da sua conta Google', efforts: [], padrao: true }];
const MODELOS_GROK = [{ id: '', nome: 'Padrão do Grok', desc: 'Usa o modelo configurado no Grok', efforts: [], padrao: true }];
function modelosDe(P) {
  if (P.engine === 'gemini') return MODELOS_GEMINI;
  if (P.engine === 'grok') return MODELOS_GROK;
  if (P.engine === 'acp') return P.model && !AGENTES_ACP.some(m => m.id === P.model)
    ? [...AGENTES_ACP, { id: P.model, nome: 'Agente personalizado', desc: P.model, efforts: ['medium'] }]
    : AGENTES_ACP;
  if (P.engine === 'claude') return MODELOS_CLAUDE;
  // testar o TAMANHO, nao so se existe: quando o Codex esta fora do ar a chamada devolve lista
  // vazia, que e "verdadeira" em JS. Sem isto, ms[0] virava undefined e quebrava criar chat
  // do Codex e trocar de motor.
  const base = (MODELOS_CODEX && MODELOS_CODEX.length) ? MODELOS_CODEX
    : [{ id: '', nome: 'padrão do Codex', desc: 'o que está no seu config', efforts: ['low','medium','high','xhigh'], padraoEffort: 'medium' }];
  return base;
}
function modeloAtual(P) {
  const ms = modelosDe(P);
  return ms.find(m => m.id === P.model) || ms.find(m => m.padrao) || ms[0];
}
function esforcosDe(P) {
  const m = modeloAtual(P);
  const e = (m.efforts || []).map(x => (typeof x === 'string' ? { id: x, desc: EF_DESC_PT[x] || '' } : { id: x.id, desc: EF_DESC_PT[x.id] || x.desc || '' }));
  return e.length ? e : [{ id: 'medium', desc: '' }];
}

const TOOL_PT = {
  Read: 'Lendo arquivo', Write: 'Criando arquivo', Edit: 'Editando arquivo', Bash: 'Terminal',
  Glob: 'Procurando arquivos', Grep: 'Buscando no código', WebSearch: 'Pesquisando na web',
  WebFetch: 'Abrindo link', Task: 'Agente', TodoWrite: 'Lista de tarefas', Skill: 'Skill',
  NotebookEdit: 'Editando notebook', BashOutput: 'Saída do terminal',
  PushNotification: 'Avisando você',
};
function toolLabel(n) {
  if (TOOL_PT[n]) return TOOL_PT[n];
  if (n && n.startsWith('mcp__')) { const p = n.split('__'); return p[1] + (p[2] ? ' · ' + p[2] : ''); }
  return n || 'Ferramenta';
}
const NA_VPS = (p) => /^vps:/i.test(String(p || ''));
const semPrefixo = (p) => String(p || '').replace(/^vps:/i, '');
const shortPath = (p) => (NA_VPS(p) ? 'VPS ' + semPrefixo(p) : String(p || '').replace(HOME, '~'));
const nomePasta = (p) => {
  if (!p) return 'Pasta';
  if (NA_VPS(p)) { const c = semPrefixo(p); return 'VPS: ' + (c.split('/').filter(Boolean).pop() || '/'); }
  if (p === HOME) return 'Pasta: Mac inteiro';
  return 'Pasta: ' + (p.split('/').pop() || p);
};
/* Um caminho citado por um painel que roda NA VPS mora na VPS, nao aqui. Sem esta cura, um
   "/tmp/x.log" escrito pelo agente da VPS abria o /tmp/x.log DO MAC, calado — outro arquivo,
   nenhum aviso. Caminho que ja vem com o prefixo, ou que nao e absoluto, passa intacto. */
const caminhoDoPainel = (P, c) =>
  (P && NA_VPS(P.cwd) && /^\//.test(String(c || '')) ? 'vps:' + c : c);
// o visor le pelo cano certo: o do Mac ou o que vai por SSH
const lerParaVisor = (c) => ((NA_VPS(c) && window.api.verArquivoVps) ? window.api.verArquivoVps(c) : window.api.verArquivo(c));

/* ============ painel ============ */
/* Contorno azul de 0,9 s no painel. Desde o redesenho só o aviso do agente (avisoDoAgente) usa:
   é um "olha aqui" que chega sozinho, e não troca de chat. Ir até um chat (torre, faixa, lista,
   recado do sistema) NÃO pisca: trocar de chat é instantâneo (README, "Movimento"). Com
   Reduzir movimento o painel.css desliga a animação. */
function piscar(P) {
  P.el.classList.remove('piscando');
  void P.el.offsetWidth;              // reinicia a animacao se clicar de novo
  P.el.classList.add('piscando');
  setTimeout(() => P.el.classList.remove('piscando'), 900);
}

/* ============ abas de projeto (uma pasta por aba) ============ */

// nome curto do projeto que aparece na aba
function nomeProjeto(cwd) {
  if (NA_VPS(cwd)) { const c = semPrefixo(cwd); return c.split('/').filter(Boolean).pop() || 'VPS'; }
  if (!cwd || cwd === HOME) return 'Mac inteiro';
  return cwd.split('/').filter(Boolean).pop() || 'Mac inteiro';
}

// cria a aba de um projeto: uma pasta, e dentro dela os chats lado a lado
function novaAbaProjeto(cwd, indice) {
  const aid = 'a' + (++abaSeq);
  const el = $('#tplAba').content.firstElementChild.cloneNode(true);
  const corpoEl = $('#tplEspaco').content.firstElementChild.cloneNode(true);
  el.dataset.aid = aid; corpoEl.dataset.aid = aid;

  const A = { id: aid, cwd: cwd || HOME, el, corpoEl, ordem: [], ativo: null };
  abas.set(aid, A);

  $('.aba-x', el).addEventListener('click', (e) => { e.stopPropagation(); fecharAba(A); });
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.aba-x')) return;
    ativarAbaProjeto(A);
    comecarArrasteAba(A, e);
  });
  el.addEventListener('dblclick', (e) => { if (!e.target.closest('.aba-x')) trocarPastaDaAba(A); });

  const lista = $('#abasLista');
  const alvo = (indice == null || indice >= lista.children.length) ? null : lista.children[indice];
  lista.insertBefore(el, alvo);
  $('#panes').appendChild(corpoEl);
  pintarAba(A);
  return A;
}

function abaDe(P) { return abas.get(P.aid); }

function pintarAba(A) {
  const n = A.ordem.length;
  const naVps = NA_VPS(A.cwd);
  A.el.classList.toggle('vps', naVps);   // aparece o ícone de servidor antes do nome (janela.css)
  $('.aba-proj', A.el).textContent = nomeProjeto(A.cwd);
  /* Cápsula do redesenho: o contador é só o número (tabular, em --label-3). "3 chats" por extenso
     não cabe numa aba de 28 e repetia o que o title já diz. Aba sem chat não mostra número. */
  $('.aba-tit', A.el).textContent = n ? String(n) : '';
  A.el.title = shortPath(A.cwd) + '\n' + (n === 1 ? '1 chat aberto' : n + ' chats abertos');
  /* A bolinha da aba mostra se algum chat dela esta trabalhando — inclusive quando só os
     agentes em segundo plano seguem rodando e o turno do chat já acabou.
     'espera' ganha de tudo e é a única que aparece em aba parada: chat travado pedindo
     permissão ou fazendo uma pergunta não anda sozinho, e antes ficava idêntico a uma aba
     parada até ele abrir a Torre de Controle na mão. */
  let estado = 'off';
  for (const pid of A.ordem) {
    const P = panes.get(pid); if (!P) continue;
    if (estadoDoPainel(P).cls === 'espera') { estado = 'espera'; break; }
    if (P.busy || agTrabalhando(P)) { estado = 'busy'; continue; }
    if (P.started && estado !== 'busy') estado = 'idle';
  }
  $('.aba-dot', A.el).className = 'aba-dot dot ' + estado;
}

/* Tarja na faixa de avisos para o chat que travou esperando ELE e está FORA da vista (outra
   aba, ou sem foco). No chat que ele está olhando a tarja seria ruído: o pedido já está na
   frente dele. O aviso do sistema não resolvia isto — ele só dispara com a janela do Cockpit
   atrás, ou seja, justamente quando ele NÃO está usando o app. */
function avisarQuemEspera() {
  if (!$('#faixaAvisos')) return;
  const vivos = new Set();
  for (const P of panes.values()) {
    const e = estadoDoPainel(P);
    // episódio novo de espera: o X que ele deu na espera anterior não vale para esta
    if (e.cls !== 'espera') { P.esperaDesde = 0; continue; }
    if (!P.esperaDesde) P.esperaDesde = Date.now();
    if (P === focusPane && abaDe(P) === abaAtiva) continue;
    const id = 'espera-' + P.id + '-' + P.esperaDesde;
    vivos.add(id);
    // tipo 'espera': o sinal é o círculo âmbar com "!" (o mesmo da aba) e o estado vai na cor
    // de "esperando você" (README, "Estados"); o triângulo fica só para o que deu errado
    mostrarAviso({
      id, tipo: 'espera', fixo: true, acao: 'ir', aoClicar: () => irAoChat(P),
      texto: [nomeDoMotor(P.engine) + ' · ' + (P.titulo || nomePasta(P.cwd)) + ' · ', { espera: e.txt }],
    });
  }
  // atendido: some da faixa na hora, sem esperar prazo nenhum
  try { $$('#faixaAvisos [data-aviso^="espera-"]').forEach((t) => { if (!vivos.has(t.dataset.aviso)) t.remove(); }); } catch {}
}
// a espera começou ou acabou: repinta a bolinha da aba daquele chat e refaz a faixa
function marcarEspera(P) {
  const A = P && abaDe(P);
  if (A) pintarAba(A);
  pintarPonto(P);          // o ponto do próprio chat muda junto com a bolinha da aba
  if (P && P.trabEl) pintaTrab(P);   // e a linha do trabalhando some/volta na mesma hora
  avisarQuemEspera();
}

function pintarTodasAbas() { for (const A of abas.values()) pintarAba(A); }

function ativarAbaProjeto(A) {
  if (!A) return;
  /* O chat que estava ditando some da tela agora: soltar o microfone antes, senão a captura
     seguia ligada atrás de uma aba escondida — sem botão aceso e sem jeito de desligar.
     `guardarTexto`: o que ele falou já está escrito no campo e continua lá, e assim ninguém
     rouba o foco no meio da troca de aba. */
  if (VIVO.P && abaDe(VIVO.P) !== A) vozSoltar(VIVO.P, { guardarTexto: true });
  if (DITADO.P && abaDe(DITADO.P) !== A) vozSoltar(DITADO.P, { guardarTexto: true });
  // ultimo instante em que a aba que sai ainda tem altura: e agora ou nunca pra anotar
  // onde cada conversa dela estava sendo lida (escondida, a medida vale 0)
  if (abaAtiva && abaAtiva !== A) for (const pid of abaAtiva.ordem) guardarRolagem(panes.get(pid));
  abaAtiva = A;
  for (const B of abas.values()) {
    const on = B === A;
    B.el.classList.toggle('ativa', on);
    B.corpoEl.classList.toggle('oculta', !on);
  }
  if (A.el.classList.contains('nova')) A.el.classList.remove('nova');
  // com muita aba a faixa rola de lado (a aba nao encolhe abaixo de 104px): a que abriu
  // tem que ficar a vista, senao o cmd+1..9 trocava para uma aba escondida
  A.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  // o chat guardado pode ter mudado de aba: nesse caso ele levaria voce de volta para a outra
  if (A.ativo && !A.ordem.includes(A.ativo)) A.ativo = null;
  const P = panes.get(A.ativo) || panes.get(A.ordem[0]);
  if (P) setFocus(P);
  else { $('#tbTitle').textContent = shortPath(A.cwd); loadTree(A.cwd); }
  // chat que recebeu resposta com a aba escondida precisa voltar rolado pro fim.
  // e chat que foi remontado ENQUANTO a aba estava escondida (arrastar chat de aba)
  // so agora tem altura pra receber de volta o ponto de leitura que ficou pendente
  for (const pid of A.ordem) {
    const q = panes.get(pid);
    if (!q) continue;
    if (q.precisaRolar) { q.precisaRolar = false; q.rolagemPendente = false; requestAnimationFrame(() => { q.chat.scrollTop = q.chat.scrollHeight; }); }
    else if (q.rolagemPendente) requestAnimationFrame(() => { if (devolverRolagem(q)) q.rolagemPendente = false; });
  }
  pintarMulti();          // a barra de baixo (modelo, modo, envio) segue a aba que abriu:
                          // sem isto, vir de uma aba de 3 chats deixava a de 1 chat comprimida
  lateralSegueAPasta();   // a lista de conversas segue o cliente da aba
  avisarQuemEspera();     // chegou no chat que esperava: a tarja dele sai da faixa
}

async function fecharAba(A) {
  if (!A) return;
  // mesma regra do chat: fechar a aba inteira com trabalho rodando dentro pergunta antes
  const ocupados = A.ordem.map(id => panes.get(id)).filter(q => q && (q.busy || agTrabalhando(q))).length;
  if (ocupados) {
    const q = ocupados === 1 ? 'um chat desta aba está trabalhando' : ocupados + ' chats desta aba estão trabalhando';
    if (!confirm('Tem ' + q + '.\n\nFechar a aba joga fora o que eles estão fazendo. Fechar mesmo assim?')) return;
  }
  // A tela sai NA HORA; mandar parar os motores acontece por baixo, em paralelo.
  // Um por um e esperando cada um (o do Codex pode levar ate 1,5s) deixava a aba pendurada
  // na tela por varios segundos depois do clique no X.
  const paraParar = [];
  for (const pid of [...A.ordem]) {
    const P = panes.get(pid);
    if (!P) continue;
    vozSoltar(P, { guardarTexto: true });   // a aba inteira sai: nenhum microfone dela pode ficar aceso
    P.tamanhoObserver?.disconnect();
    if (P.fecharTerminal) { try { P.fecharTerminal(); } catch {} }
    paraParar.push({ pid, engine: P.engine });
    guardarFechado(P);   // fechar a aba tambem alimenta o "Reabrir o ultimo chat fechado"
    // mesma regra do closePane: o quadro branco nao pode sobreviver ao painel dono
    if (window.Quadro && window.Quadro.aberto && window.Quadro.aberto() && window.Quadro.donoEh && window.Quadro.donoEh(P)) { try { window.Quadro.fechar(); } catch (_) {} }
    // idem pro painel "Time de agentes": a aba inteira sai, o painel de agentes dela nao pode sobrar
    if (agPaneAberto === P) { try { fecharPainelAgentes(); } catch (_) {} }
    P.el.remove(); panes.delete(pid);
  }
  A.ordem = [];
  marcarAbertas();          // fechou a aba inteira: apaga a borda de todas as conversas dela
  Promise.all(paraParar.map(x => window.api.paneStop({ paneId: x.pid, engine: x.engine }).catch(() => {})));
  const lista = [...abas.values()];
  const i = lista.indexOf(A);
  A.el.remove(); A.corpoEl.remove(); abas.delete(A.id);
  if (focusPane && !panes.has(focusPane.id)) focusPane = null;
  const resto = [...abas.values()];
  if (!resto.length) { abaAtiva = null; telaNovaAba(true); }
  else ativarAbaProjeto(resto[Math.max(0, i - 1)] || resto[0]);
  savePanes(true);   // foi ELE que fechou: esta e a unica gravacao que pode ter menos abas
}

// pasta nova = vida nova: a memoria, o historico e o trabalho passam a ser os da pasta,
// entao a conversa antiga (que era da pasta velha) nao vai junto
function conversaDaPastaNova(P, pasta) {
  invalidarConversa(P);
  // O processo antigo foi morto aqui. Sem zerar o "ocupado", o evento de fim de turno nunca
  // chega (nao ha mais processo pra manda-lo) e TODA mensagem seguinte fica presa em "na fila",
  // para sempre. E o que estava na fila morreu junto com o processo.
  P.busy = false; P.queued = null; P.filaMsgs = []; escondePerm(P);
  pararTrabalho(P); limparPassos(P); limparContinuar(P);
  P.sessaoId = null; P.sessaoFile = ''; P.resumeId = null;
  P.passarContexto = null; P.edicoes = [];
  esquecerCadeiaDoPainel(P);   // 25/09: conversa nova de verdade, não costura com a da pasta velha
  zerarContexto(P);          // conversa nova: o medidor volta ao zero
  // leva 8.3: o fio mudou de conversa — a intenção de ramificar não pode ir junto, senão a
  // próxima mensagem forkaria a conversa ERRADA, em silêncio
  P.forkPendente = false;
  /* leva 10.5: a pasta mudou, então a branch isolada da pasta ANTIGA não vai junto. Sem esta
     linha o chat passaria a criar um .claude/worktrees/<nome> dentro da pasta nova, calado.
     Esta função é chamada nos QUATRO pontos em que a pasta de um chat muda (trocar a pasta da
     aba, arrastar o chat para outra aba, e os dois ramos do levarChatPara). */
  P.worktree = '';
  P.titulo = ''; P.nomeManual = false; P.nomeCurto = false; P.hist = []; limparPlano(P); limparSugestoes(P);
  P.blocks.clear(); P.tools.clear();
  P.ultraAvisado = false;
  voltarVazio(P);
  pintarNome(P);
}

async function trocarPastaDaAba(A) {
  // R2-015: aba da VPS nao tem Finder — o dialog nativo do Mac (pickFolder) ignora o prefixo
  // "vps:/..." e deixa escolher qualquer pasta local, sem aviso nenhum de que trocou de
  // servidor. Igual ja acontecia na troca por PAINEL (mudarPastaDoChat -> pedirCaminhoVps),
  // mas faltava aqui na troca por ABA.
  if (NA_VPS(A.cwd)) return pedirCaminhoVpsDaAba(A);
  const p = await window.api.pickFolder(A.cwd);
  if (!p || p === A.cwd) return;
  await aplicarPastaNaAba(A, p);
}

// move TODOS os chats da aba pra pasta nova (local ou VPS) — usado pelo Finder e pelo campo da VPS
async function aplicarPastaNaAba(A, p) {
  if (!p || p === A.cwd) return;
  // mesma regra do fechar aba: mudar a pasta mata o motor de cada chat da aba — pergunta uma vez
  // só, agregado, e a aba muda inteira ou não muda (evita ficar com metade numa pasta e metade noutra)
  const ocupados = A.ordem.map(id => panes.get(id)).filter(q => q && (q.busy || agTrabalhando(q))).length;
  if (ocupados) {
    const q = ocupados === 1 ? 'um chat desta aba está trabalhando' : ocupados + ' chats desta aba estão trabalhando';
    if (!confirm('Tem ' + q + '.\n\nMudar a pasta joga fora o que eles estão fazendo. Mudar mesmo assim?')) return;
  }
  A.cwd = p;
  pintarAba(A);
  // os chats dessa aba passam a viver na pasta nova
  for (const pid of A.ordem) {
    const P = panes.get(pid); if (!P) continue;
    await desligarMotor(P);
    if (panes.get(pid) !== P) continue;
    P.cwd = p; P.started = false; setDot(P, 'off');
    pintarPasta(P, nomePasta(p));
    conversaDaPastaNova(P, p);
    mostrarPastaNoPainel(P); atualizarGit(P);   // leva 10: tira o "⎇ nome" e repõe o chip do git
  }
  if (abaAtiva === A) { loadTree(p); const pn = $('#projName'); if (pn) pn.textContent = nomePasta(p); }
  lateralSegueAPasta();
  savePanes();
}

// chat na VPS nao tem Finder: pede o caminho de la, ancorado no chat ativo da aba (ou o 1o),
// e ao confirmar move a ABA INTEIRA — nao so um chat, senao diverge de trocarPastaDaAba
function pedirCaminhoVpsDaAba(A) {
  const ancora = panes.get(A.ativo) || panes.get(A.ordem[0]);
  if (!ancora) return;   // aba sem nenhum chat vivo: nao ha onde ancorar o modal
  const modal = $('.p-modal', ancora.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  cx.className = 'modal-cx cx-vps';
  cx.onclick = (e) => e.stopPropagation();
  // a explicacao fica no balao do titulo: na tela, so o rotulo (redesenho 25/09)
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit" title="Digite o caminho de lá. Todos os chats desta aba vão pra essa pasta.">Pasta na VPS</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<input class="na-caminho" id="vpsCaminho" spellcheck="false">'
    + '<div class="na-atalhos" id="vpsAtalhos"></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="vpsOk">Ir</button></div>';
  const inp = $('#vpsCaminho', cx);
  inp.value = semPrefixo(A.cwd);
  for (const cam of PASTAS_VPS) {
    const b = document.createElement('button');
    b.className = 'na-atalho'; b.textContent = cam;
    b.onclick = () => { inp.value = cam; inp.focus(); };
    $('#vpsAtalhos', cx).appendChild(b);
  }
  const irAba = () => {
    // tira um "vps:" que o usuário já tenha digitado, senão dobra o prefixo
    const c = semPrefixo((inp.value || '').trim());
    fecharModal(ancora);
    if (!c) return;
    aplicarPastaNaAba(A, 'vps:' + (c.startsWith('/') ? c : '/' + c));
  };
  $('#vpsOk', cx).onclick = irAba;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); irAba(); } });
  $('.mo-x', cx).onclick = () => fecharModal(ancora);
  modal.onclick = (e) => { if (e.target === modal) fecharModal(ancora); };
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

// tira o chat de onde esta e coloca em outra posicao (ou em outra aba)
function moverPane(P, A, indice) {
  const antiga = abaDe(P);
  // pasta vai mudar: motor que nao roda no destino bloqueia, e trabalho em andamento pergunta
  // antes de matar — TUDO antes de mexer em ordem/aid, senao um "nao" deixa o painel numa aba errada
  if (antiga && antiga !== A && P.cwd !== A.cwd) {
    const motivo = motorIndisponivelNaPasta(P.engine, A.cwd);
    if (motivo) { avisoTemp(P, motivo, true); return; }
    if (!confirmarCorte(P, 'Mudar de pasta')) return;
  }
  // este chat vai sair de onde esta: os que ficam alargam na hora e o texto reflui.
  // as DUAS abas mudam de largura, e o proprio chat que se muda tambem precisa ser anotado.
  guardarAntesDeMexer([antiga, A], null);
  try {
  if (antiga) {
    const i = antiga.ordem.indexOf(P.id);
    if (i >= 0) antiga.ordem.splice(i, 1);
    if (antiga.ativo === P.id) antiga.ativo = antiga.ordem[Math.max(0, i - 1)] || antiga.ordem[0] || null;
  }
  if (indice == null || indice >= A.ordem.length) A.ordem.push(P.id);
  else A.ordem.splice(indice, 0, P.id);
  P.aid = A.id;
  if (antiga !== A) { P.coluna = crypto.randomUUID(); P.larguraColuna = 0; P.pesoAltura = 1; }
  // mudou de projeto: o chat recomeca na pasta da aba nova
  if (antiga && antiga !== A && P.cwd !== A.cwd) {
    P.trocando = true;
    const parada = window.api.paneStop({ paneId: P.id, engine: P.engine });
    P.cwd = A.cwd; P.started = false; setDot(P, 'off');
    pintarPasta(P, nomePasta(P.cwd));
    conversaDaPastaNova(P, P.cwd);
    const revisao = P.revisaoConversa;
    Promise.resolve(parada).catch(() => {}).finally(() => {
      if (painelAindaAtual(P, revisao)) P.trocando = false;
    });
    mostrarPastaNoPainel(P); atualizarGit(P);   // leva 10: tira o "⎇ nome" e repõe o chip do git
  }
  remontarEspaco(A);
  if (antiga && antiga !== A) {
    if (!antiga.ordem.length) removerAbaVazia(antiga);
    else { remontarEspaco(antiga); pintarAba(antiga); }
  }
  pintarAba(A);
  if (abaAtiva !== A) ativarAbaProjeto(A);
  setFocus(P);
  lateralSegueAPasta();
  // arrastar o ultimo chat pra outra aba esvazia a de origem, e ela some: tambem e ele pedindo
  savePanes(true);
  } finally { guardaTravada = false; }
}

// tira da tela a aba que ficou sem chat (sem mexer em qual aba esta aberta)
function removerAbaVazia(A) {
  if (!A || A.ordem.length) return;
  A.el.remove(); A.corpoEl.remove(); abas.delete(A.id);
  if (abaAtiva === A) abaAtiva = null;
}

// chat que vive na VPS nao tem Finder: pede o caminho num campo dentro do proprio chat
function pedirCaminhoVps(P) {
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  cx.className = 'modal-cx cx-vps';
  cx.onclick = (e) => e.stopPropagation();
  // a explicacao fica no balao do titulo: na tela, so o rotulo (redesenho 25/09)
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit" title="Digite o caminho de lá. O chat vai para a aba dessa pasta.">Pasta na VPS</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<input class="na-caminho" id="vpsCaminho" spellcheck="false">'
    + '<div class="na-atalhos" id="vpsAtalhos"></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="vpsOk">Ir</button></div>';
  const inp = $('#vpsCaminho', cx);
  inp.value = semPrefixo(P.cwd);
  for (const cam of PASTAS_VPS) {
    const b = document.createElement('button');
    b.className = 'na-atalho'; b.textContent = cam;
    b.onclick = () => { inp.value = cam; inp.focus(); };
    $('#vpsAtalhos', cx).appendChild(b);
  }
  const ir = () => {
    // tira um "vps:" que o usuário já tenha digitado, senão dobra o prefixo
    const c = semPrefixo((inp.value || '').trim());
    fecharModal(P);
    if (!c) return;
    levarChatPara(P, 'vps:' + (c.startsWith('/') ? c : '/' + c));
  };
  $('#vpsOk', cx).onclick = ir;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ir(); } });
  $('.mo-x', cx).onclick = () => fecharModal(P);
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

// trocar a pasta DE UM CHAT: ele se muda para a aba daquela pasta
async function mudarPastaDoChat(P) {
  if (NA_VPS(P.cwd)) return pedirCaminhoVps(P);
  const escolhida = await window.api.pickFolder(P.cwd);
  if (!escolhida || escolhida === P.cwd) return;
  return levarChatPara(P, escolhida);
}

async function levarChatPara(P, escolhida) {
  if (!escolhida || escolhida === P.cwd) return;
  /* leva 10.5: cinto e suspensório. O conversaDaPastaNova já zera a branch isolada nos dois
     ramos de baixo, mas o terceiro (moverPane) só o chama quando a pasta do chat difere da da
     aba de destino — aqui a limpeza vale para os TRÊS, sem exceção. */
  P.worktree = '';
  const A0 = abaDe(P);
  const jaExiste = abaDoCaminho(escolhida, false);

  if (jaExiste && jaExiste === A0) {   // ja e a aba certa: so a subpasta do chat muda
    if (!confirmarCorte(P, 'Mudar de pasta')) return;
    await desligarMotor(P);
    if (panes.get(P.id) !== P) return;
    P.cwd = escolhida; P.started = false; setDot(P, 'off');
    pintarPasta(P, nomePasta(escolhida));
    conversaDaPastaNova(P, escolhida);
    mostrarPastaNoPainel(P); atualizarGit(P);   // leva 10: tira o "⎇ nome" e repõe o chip do git
    savePanes();
    return;
  }

  // este chat esta sozinho na aba e nao ha outra aba com essa pasta:
  // e mais simples a propria aba mudar de pasta do que criar outra
  if (!jaExiste && A0 && A0.ordem.length === 1) {
    if (!confirmarCorte(P, 'Mudar de pasta')) return;
    A0.cwd = escolhida;
    await desligarMotor(P);
    if (panes.get(P.id) !== P) return;
    P.cwd = escolhida; P.started = false; setDot(P, 'off');
    pintarPasta(P, nomePasta(escolhida));
    pintarAba(A0);
    if (abaAtiva === A0) { loadTree(escolhida); const pn = $('#projName'); if (pn) pn.textContent = nomePasta(escolhida); setFocus(P); }
    conversaDaPastaNova(P, escolhida);
    mostrarPastaNoPainel(P); atualizarGit(P);   // leva 10: tira o "⎇ nome" e repõe o chip do git
    lateralSegueAPasta();
    savePanes();
    return;
  }

  const destino = jaExiste || novaAbaProjeto(escolhida);
  moverPane(P, destino, null);
}

/* ─── Onde cada conversa estava sendo lida ────────────────────────────────────
   Painel tirado do DOM perde o layout: quando ele volta, o navegador nao tem mais
   de onde tirar a rolagem e TODA conversa da aba salta pro comeco. Por isso o ponto
   de leitura precisa estar guardado aqui em JS ANTES de mexer no DOM.
   Guardo a MENSAGEM que estava no alto da area visivel, e nao o numero de pixels:
   fechar um chat alarga os que sobram, o texto reflui e o mesmo numero de pixels
   passa a ser outro trecho da conversa (medido: -28% de altura ao fechar 1 de 3). */
let guardaTravada = false;
/* Anotar DEPOIS de ja ter mexido no DOM e anotar o estrago: tirar um painel alarga na hora
   os que sobram, o texto reflui e a conversa ja pulou. Entao quem vai mexer no DOM chama
   isto ANTES, e a trava impede que remontarEspaco/igualarChats refotografem por cima. */
function guardarAntesDeMexer(listaAbas, exceto) {
  for (const A of listaAbas) {
    if (!A) continue;
    for (const pid of A.ordem) if (pid !== exceto) guardarRolagem(panes.get(pid));
  }
  guardaTravada = true;
}

function guardarRolagem(P) {
  if (guardaTravada) return;           // ja foi anotado antes de o DOM mudar: aquela foto vale mais
  const c = P && P.chat;
  if (!c || !c.clientHeight) return;   // aba escondida nao tem altura: leitura daria 0 e envenenaria o guardado
  // quem estava colado no fim tem que CONTINUAR colado no fim, inclusive se chegar
  // mensagem nova no meio do caminho (mesma regua de 100px do atBottom)
  if (c.scrollHeight - c.scrollTop - c.clientHeight < 100) { P.rolagem = { noFim: true }; return; }
  const ks = c.children;
  if (!ks.length) { P.rolagem = { top: c.scrollTop }; return; }
  const rc = c.getBoundingClientRect();
  // passo escondido (modo foco) tem offsetTop e altura ZERO e bagunçaria a conta: pular pro
  // proximo que aparece na tela mantem a sequencia crescente de que a busca precisa
  const visivel = m => { let j = m; while (j < ks.length && !ks[j].offsetHeight) j++; return j; };
  const p0 = visivel(0);
  if (p0 >= ks.length) { P.rolagem = { top: c.scrollTop }; return; }
  // Medir mensagem por mensagem custava caro em conversa longa (8ms por chat com 6000
  // mensagens, e trocar de aba faz isso o tempo todo). offsetTop so cresce de uma mensagem
  // pra outra, entao da pra achar por busca binaria: ~13 medidas em vez de 6 mil.
  // 'desloc' traduz offsetTop (que conta a partir de um ancestral) para a mesma regua do
  // getBoundingClientRect, pra a busca dar exatamente a mesma mensagem que a varredura antiga.
  const desloc = ks[p0].offsetTop - (ks[p0].getBoundingClientRect().top - rc.top) - c.scrollTop;
  const alvo = c.scrollTop + desloc + 1;
  let lo = 0, hi = ks.length - 1, achou = -1;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1, m = visivel(meio);
    if (m > hi) { hi = meio - 1; continue; }
    if (ks[m].offsetTop + ks[m].offsetHeight > alvo) { achou = m; hi = meio - 1; } else lo = m + 1;
  }
  if (achou < 0) { P.rolagem = { top: c.scrollTop }; return; }
  let f = ks[achou], r = f.getBoundingClientRect();
  // rede de seguranca (normalmente zero passos), caso alguma mensagem saia do fluxo normal
  while (r.bottom <= rc.top + 1 && f.nextElementSibling) { f = f.nextElementSibling; r = f.getBoundingClientRect(); }
  // 'corte' e o quanto da mensagem ficou pra cima; 'alt' e a altura dela agora e 'larg' a
  // largura do chat agora (so se a largura mudar e que o corte precisa encolher junto)
  P.rolagem = { anc: f, corte: rc.top - r.top, alt: r.height, larg: c.clientWidth, top: c.scrollTop };
}

// devolve a conversa ao mesmo ponto de leitura. false = a aba ainda esta escondida,
// nao da pra medir agora e o conserto fica pendente pra quando ela aparecer
function devolverRolagem(P) {
  const g = P && P.rolagem, c = P && P.chat;
  if (!g || !c || !c.isConnected || !c.clientHeight) return false;
  if (g.noFim) { c.scrollTop = c.scrollHeight; return true; }
  /* O passo que o Modo foco esconde (body.foco .exec/.think = display:none) fica SEM retangulo:
     getBoundingClientRect() vem tudo zero e a conta la embaixo viraria um numero solto — a
     leitura pulava telas inteiras ao LIGAR o foco. Nesse caso a ancora anda para o primeiro
     vizinho que ainda aparece, encostado no topo. */
  let anc = g.anc, corteG = g.corte, altG = g.alt;
  if (anc && anc.parentNode === c && !anc.offsetHeight) {
    let v = anc.nextElementSibling;
    while (v && !v.offsetHeight) v = v.nextElementSibling;
    anc = v; corteG = 0; altG = 0;
  }
  if (anc && anc.parentNode === c) {
    const rc = c.getBoundingClientRect(), r = anc.getBoundingClientRect();
    // a mensagem mudou de tamanho junto com a largura: manter o corte em pixels crus
    // jogaria o olho pra outro pedaco DENTRO dela (grave num bloco de codigo comprido).
    // Mas se a largura NAO mudou, ela cresceu porque o motor esta escrevendo dentro dela:
    // ai encolher o corte empurraria a leitura pra frente sozinha. Por isso a condicao.
    const mudouLarg = g.larg && c.clientWidth !== g.larg;
    const corte = (mudouLarg && altG > 0 && r.height > 0) ? corteG * (r.height / altG) : corteG;
    const alvo = c.scrollTop + (r.top - rc.top) + corte;
    c.scrollTop = Math.max(0, Math.min(alvo, c.scrollHeight - c.clientHeight));
    return true;
  }
  c.scrollTop = g.top || 0;   // a mensagem-ancora sumiu (conversa limpa): resta o numero cru
  return true;
}

/* Embrulho unico: guarda o ponto de leitura de todos os chats da aba, faz o trabalho
   e devolve. Devolve DUAS vezes de proposito: a primeira ainda no mesmo quadro, antes
   de o navegador pintar, pra ninguem ver a tela piscar no comeco da conversa; a segunda
   no quadro seguinte, porque quem mexe na LARGURA (igualarChats, pintarMulti) so age
   depois — e no layout novo o mesmo ponto ja seria outra linha. */
function semPerderRolagem(A, tarefa) {
  const vivos = A ? (A.ordem || []).map(pid => panes.get(pid)).filter(Boolean) : [];
  vivos.forEach(guardarRolagem);
  tarefa();
  const repor = () => {
    for (const P of vivos) {
      if (!panes.has(P.id)) continue;
      P.rolagemPendente = !devolverRolagem(P);
    }
  };
  repor();
  requestAnimationFrame(repor);
}

// redesenha os chats de uma aba na ordem certa, com os divisores entre eles
function remontarEspaco(A) { montarColunasDaAba(A); }

function newPane(opts = {}) {
  const id = ESTA_TELA + 'p' + (++paneSeq);
  const el = $('#tplPane').content.firstElementChild.cloneNode(true);
  el.dataset.id = id;

  const A = opts.aba || abaAtiva || novaAbaProjeto(opts.cwd || cfg.defCwd || HOME);
  const motorDoPainel = opts.engine || motorVisivel(cfg.lastEngine);
  const P = {
    id, el, aid: A.id,
    coluna: typeof opts.coluna === 'string' ? opts.coluna : crypto.randomUUID(),
    larguraColuna: Math.max(0, Math.min(2400, Number(opts.larguraColuna) || 0)),
    pesoAltura: Math.max(.1, Math.min(10, Number(opts.pesoAltura) || 1)),
    plano: normalizarPlano(opts.plano), planoAberto: opts.planoAberto !== false,
    engine: motorDoPainel,
    cwd: opts.cwd || A.cwd,                // a pasta e a da aba
    model: opts.model || modeloNovo(motorDoPainel),
    started: false, busy: false, queued: null, filaMsgs: [], hist: [], passarContexto: null,
    titulo: opts.titulo || '', sessaoId: null, sessaoFile: '', anexos: [],
    // 25/09: a conversa de antes da última troca de IA (esperando costura) e as partes mais velhas
    parteAnterior: null, partesAnteriores: [],
    envio: cfg.envioPadrao || 'fila',
    // conversa nova nasce no esforço de PADRAO_NOVO; painel restaurado mantém o que estava salvo
    mode: opts.mode || cfg.defMode || 'auto', effort: opts.effort || esforcoNovo(motorDoPainel),
    serviceTier: opts.serviceTier || '', experimentalContext: opts.experimentalContext === true,
    collaborationMode: opts.collaborationMode === 'plan' || (!opts.collaborationMode && (opts.mode || cfg.defMode) === 'plan') ? 'plan' : 'default',
    effectiveSettings: null, settingsPending: false,
    // leva 10.5: nome da branch isolada em .claude/worktrees/<nome>; vazio = pasta principal
    worktree: opts.worktree || '',
    blocks: new Map(), tools: new Map(), execEl: null, trabTimer: null, trabOque: '',
    chat: $('.pane-chat', el),
  };
  panes.set(id, P);
  observarAlturaPainel(P);

  // Os quatro assistentes ficam disponíveis em qualquer painel.
  $$('.ch-lado', el).forEach(bt => {
    $('span', bt).innerHTML = svgMotor(bt.dataset.motor);
    bt.addEventListener('click', () => trocarMotor(P, bt.dataset.motor));
  });
  try { new ResizeObserver(() => posicionarChave(P)).observe($('.p-chave', el)); } catch {}

  // modelo
  $('.p-model', el).addEventListener('click', (e) => { e.stopPropagation(); menuModelos(P); });

  /* O anel do contexto sempre disse "clique para resumir" na dica, mas nunca teve clique
     ligado — nem no Mac nem no celular. Agora tem: é o mesmo resumir do menu de ações. */
  const btCompactar = $('.p-compactar', el);
  if (btCompactar) btCompactar.addEventListener('click', (e) => { e.stopPropagation(); compactarConversa(P); });
  pintarAnel(P);   // o anel aparece desde o chat vazio (README: sempre na barra); nasce vazio

  // pasta
  const btnCwd = $('.p-cwd', el);
  pintarPasta(P, nomePasta(P.cwd));
  btnCwd.addEventListener('click', () => mudarPastaDoChat(P));

  $('.p-close', el).addEventListener('click', () => closePane(id));

  // arrastar o chat pelo cabecalho para trocar de lugar na tela
  $('.pane-hd', el).addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button')) return;
    setFocus(P);
    comecarArrastePane(P, e);
  });

  $('.pn-edit', el).innerHTML = ico('pencil');
  $('.pn-edit', el).addEventListener('click', () => renomearAqui(P));
  $('.pn-txt', el).addEventListener('dblclick', () => renomearAqui(P));

  // O menu da cabeceira também organiza sem precisar arrastar.
  $('.pane-hd', el).title = 'Arraste para empilhar ou separar. Botão direito para organizar.';
  $('.pane-hd', el).addEventListener('contextmenu', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const outros = abaDe(P).ordem.map(id => panes.get(id)).filter(q => q && q !== P);
    const itens = outros.map(q => ({ ic: 'panel-left', nome: 'Empilhar com ' + (q.titulo || nomeDoMotor(q.engine)),
      fn: () => organizarPainel(P, q, true) }));
    itens.push({ ic: 'panel-left', nome: 'Deixar em coluna própria', fn: () => separarPainel(P) });
    abrirMenuLayout(P, e, itens);
  });

  // input
  const inp = $('.p-input', el);
  /* a div da conversa nao recebia foco de teclado, entao seta, Home, End e PageUp nao rolavam
     nada depois de clicar nela. O -1 deixa focar por clique sem entrar na fila do Tab. */
  const chatEl = $('.pane-chat', el);
  if (chatEl) { chatEl.setAttribute('tabindex', '-1'); chatEl.style.outline = 'none'; }
  const grow = () => { inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px'; };
  inp.addEventListener('input', grow);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      /* campo vazio com pedido de autorização à vista: ↩ permite e ⌥↩ sempre permite (tela de
         atalhos). Com texto escrito o Enter continua sendo mensagem. No meio do ditado, não:
         campo vazio ali é falha de captação, não resposta. */
      if (!inp.value.trim() && !(P.anexos || []).length && !P.quadroColado
          && VIVO.P !== P && DITADO.P !== P && teclaDoPedido(P, e)) return;
      e.preventDefault(); send(P);
    }
    /* O Esc NAO e tratado aqui. Ele e do tratador do documento, que sobe a escada na ordem
       certa: quadro > painel de agentes > visor > popup > parar a IA. Quando este bloco
       existia, um unico Esc mandava DOIS pedidos de parar (3ms de diferenca) e, com um menu
       aberto, fechava o menu E parava a IA no mesmo aperto. */
    if (e.key === 'Tab' && !e.shiftKey) {
      // Tab no campo mandava o foco para o botao "+" de anexo, e a proxima letra sumia:
      // para ele isso e "o app travou". Aqui Tab vira recuo e o cursor nao sai do lugar.
      e.preventDefault();
      const a = inp.selectionStart, b = inp.selectionEnd;
      inp.setRangeText('  ', a, b, 'end');
      inp.dispatchEvent(new Event('input'));
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      // com o cursor no campo (o estado padrao), nada rolava a conversa: ele precisava do mouse
      const c = $('.pane-chat', el);
      if (c) { e.preventDefault(); c.scrollTop += (e.key === 'PageDown' ? 1 : -1) * c.clientHeight * 0.9; }
    }
  });
  /* Seta pra cima traz de volta o que voce ja mandou, como no terminal. Ouvinte SEPARADO de
     proposito: o de cima trata Enter, Tab e PageUp e nao pode ser mexido — e o Esc continua
     sendo do documento, que sobe a escada na ordem certa. */
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const lista = historicoPrompts();
      if (!lista.length) return;
      const naPrimeiraLinha = inp.selectionStart === 0 && inp.selectionEnd === 0;
      const vazio = !inp.value.trim();
      // depois de trazer um prompt o cursor vai pro FIM, entao 'naPrimeiraLinha' virava false
      // e o proximo Up era barrado: dava pra ver so o ultimo prompt
      if (e.key === 'ArrowUp' && !(vazio || naPrimeiraLinha || P.navHist !== undefined)) return;
      if (e.key === 'ArrowDown' && P.navHist === undefined) return;
      e.preventDefault();
      if (P.navHist === undefined) { P.rascunhoAntes = inp.value; P.navHist = lista.length; }
      P.navHist += (e.key === 'ArrowUp' ? -1 : 1);
      if (P.navHist < 0) P.navHist = 0;
      if (P.navHist >= lista.length) { P.navHist = undefined; inp.value = P.rascunhoAntes || ''; }
      else inp.value = lista[P.navHist];
      grow();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Dead' || e.key === 'Process'
               || ((e.key || '').length === 1 && !e.ctrlKey && !e.metaKey)) {
      // so sai do modo historico ao MEXER no texto: antes Home, End e as setas laterais ja
      // descartavam o rascunho guardado. O (e.key || '') e por causa do teclado de acento e
      // do teclado japones, onde e.key pode vir indefinido e a linha estourava
      P.navHist = undefined;
    }
  });
  /* "@" em qualquer lugar da linha: completa caminho de arquivo da pasta deste painel.
     Ouvinte SEPARADO e ANTES do da "/": o de baixo trata a barra e nao pode ser mexido. */
  inp.addEventListener('input', () => {
    const v = inp.value;
    const cursor = inp.selectionStart || v.length;
    const mm = /@([^\s@]*)$/.exec(v.slice(0, cursor));
    if (mm) menuArquivos(P, mm[1]);
    // apagou o "@": fecha o menu e cancela a busca que ainda vinha pela rede (senao ela
    // abriria o menu sozinha segundos depois, por cima do que estivesse na tela)
    else { if (menuDeArquivosNaTela(P)) fecharMenus(); pararBuscaEmVoo(P); }
  });
  // apagou o campo na mao com o quadro colado e sem anexo: o metadado do quadro tem que
  // sair junto, senao send() acha que ainda ha algo pra mandar e envia mensagem vazia
  inp.addEventListener('input', () => {
    if (!inp.value.trim() && !(P.anexos || []).length) P.quadroColado = null;
  });
  // barra no comeco da linha abre o menu de acoes, e vai filtrando conforme digita
  inp.addEventListener('input', () => {
    const v = inp.value;
    if (v.startsWith('/') && !v.includes(' ')) {
      const busca = $('.p-modal .menu-search', el);
      if (busca) { busca.value = v.slice(1); busca.dispatchEvent(new Event('input')); }
      else { const t = v.slice(1); inp.value = ''; inp.style.height = 'auto'; menuSkills(P, t, true); }
    }
  });
  inp.addEventListener('focus', () => setFocus(P));
  el.addEventListener('mousedown', () => setFocus(P));
  // colar com cmd+V: imagem da area de transferencia ou arquivo copiado no Finder
  const colar = async (e) => {
    const dt = e.clipboardData;
    const temTexto = dt && [...(dt.items || [])].some(i => i.kind === 'string' && i.type === 'text/plain');
    const arquivos = dt ? [...(dt.files || [])].map(f => f.path).filter(Boolean) : [];
    if (arquivos.length) { e.preventDefault(); setFocus(P); await anexar(P, arquivos); return; }
    // Copiar do Excel, do Word ou de um site traz TEXTO e, junto, uma imagem da selecao.
    // Antes o codigo pegava a imagem e grudava um print fantasma na mensagem — e ainda por
    // cima gravava um PNG na pasta 'colados' a cada colagem. Havendo texto, texto ganha.
    if (temTexto) return;                 // deixa o navegador colar o texto, como sempre
    // so imagem: cancelar o padrao AGORA. Depois de um await ja e tarde, o navegador colou.
    e.preventDefault();
    const r = await window.api.colados();
    if (r && r.arquivos && r.arquivos.length) { setFocus(P); await anexar(P, r.arquivos); }
    // R2-037: antes falha e "nada pra colar" pareciam a mesma coisa (tela muda)
    else if (r && r.error) avisoTemp(P, 'Não consegui colar a imagem: ' + r.error, true);
  };
  el.addEventListener('paste', colar);   // um so: o evento do campo sobe ate aqui

  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('soltando'); });
  el.addEventListener('dragleave', () => el.classList.remove('soltando'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault(); el.classList.remove('soltando');
    const fs = [...(e.dataTransfer.files || [])].map(f => f.path).filter(Boolean);
    if (fs.length) { setFocus(P); await anexar(P, fs); }
  });

  $('.p-send', el).addEventListener('click', () => send(P));
  $('.p-stop', el).addEventListener('click', () => window.api.paneInterrupt({ paneId: id, engine: P.engine }));

  // botao do modo (abre o menu de Modos)
  $('.p-modo', el).addEventListener('click', (e) => { e.stopPropagation(); menuModos(P); });


  const btEnvio = $('.p-modoenvio', el);
  const pintarEnvio = () => {
    const entra = P.envio === 'entra';
    /* 'queue' é o desenho de "modo de envio" do redesenho, nos dois modos: quem diz o modo é o
       fundo (.ligado = "entrar na fila" ligado, como o plano), não um segundo desenho (o raio do
       Entra não existe no desenho). O rótulo (Entra/Fila) continua: com um chat só na aba é ele
       que diz o modo; com vários (#panes.multi) e no celular o CSS o esconde. */
    btEnvio.innerHTML = ico('queue') + '<span>' + (entra ? 'Entra' : 'Fila') + '</span>';
    btEnvio.classList.toggle('ligado', !entra);
    btEnvio.setAttribute('aria-pressed', String(!entra));
    btEnvio.title = entra
      ? 'Se ele estiver trabalhando, sua mensagem chega na hora e ELE decide: atende agora ou assim que terminar'
      : 'Se ele estiver trabalhando, sua mensagem espera ele terminar para só então começar';
  };
  P.pintarEnvio = pintarEnvio;
  pintarEnvio();
  btEnvio.addEventListener('click', (e) => {
    e.stopPropagation();
    P.envio = P.envio === 'entra' ? 'fila' : 'entra';
    cfg.envioPadrao = P.envio; window.api.setConfig(cfg);
    pintarEnvio();
  });

  // botao +  (anexar)
  $('.p-plus', el).addEventListener('click', (e) => { e.stopPropagation(); menuAnexo(P); });
  // botao /  (comandos)
  $('.p-slash', el).addEventListener('click', (e) => { e.stopPropagation(); menuSkills(P); });

  // botao do quadro branco (desenhar o fluxo em vez de descrever com palavras)
  criarBotaoQuadro(P, el);

  // botao do time de agentes (fica na direita, ao lado do modelo)
  criarBotaoAgentes(P, el);
  criarControlesCodex(P);

  // botao do microfone (ditar em vez de digitar)
  const btMic = document.createElement('button');
  btMic.className = 'cb p-mic'; btMic.title = 'Ditar (⌘⇧D)'; btMic.innerHTML = ico('mic');
  btMic.addEventListener('click', (e) => { e.stopPropagation(); alternarDitado(P); });
  $('.p-slash', el).insertAdjacentElement('afterend', btMic);

  /* "…": em painel estreito (menos de 400) o CSS esconde modo de envio, plano, quadro e time e
     mostra este botão, que abre os quatro num menu. Cada item só CLICA o botão de verdade: o
     que ele faz continua morando num lugar só. */
  const btMais = $('.p-mais', el);
  if (btMais) btMais.addEventListener('click', (e) => { e.stopPropagation(); menuMais(P); });

  pintarPasta(P, nomePasta(P.cwd));
  fillModels(P); paintEngine(P); pintarModo(P); pintarUso(P); lerUso(P.engine);
  if (!opts.model) aplicarEscolhaDaPasta(P);   // esta pasta ja tem cerebro preferido?

  if (opts.indice == null || opts.indice >= A.ordem.length) A.ordem.push(id);
  else A.ordem.splice(opts.indice, 0, id);
  remontarEspaco(A);
  pintarAba(A);
  if (P.plano.length) desenharPlano(P, P.plano);
  if (abaAtiva !== A) ativarAbaProjeto(A);
  setFocus(P);
  inp.focus();
  setTimeout(() => {
    if (focusPane === P && abaDe(P) === abaAtiva) el.scrollIntoView({ behavior: window.SEM_ELECTRON ? 'instant' : 'smooth', inline: 'nearest', block: 'nearest' });
  }, 60);
  setTimeout(savePanes, 30);
  return P;
}

// com mais de um grupo aberto o espaco aperta: a barra de baixo fica so com os icones
function pintarMulti() {
  const n = abaAtiva ? abaAtiva.ordem.length : 0;
  $('#panes').classList.toggle('multi', n > 1);
}

function makeSplitter() {
  const s = document.createElement('div');
  s.className = 'pane-split';
  s.title = 'Arraste para mudar o tamanho deste chat · clique duas vezes para deixar todos iguais';

  // dois cliques: todos voltam ao tamanho padrao, dividindo a tela por igual
  s.addEventListener('dblclick', (e) => {
    e.preventDefault(); e.stopPropagation();
    igualarChats(true);
  });

  // clicar e segurar: muda o tamanho SO do chat da esquerda; os outros se acomodam
  s.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const alvo = s.previousElementSibling;
    if (!alvo || !alvo.classList.contains('coluna')) return;
    const x0 = e.clientX, w0 = alvo.getBoundingClientRect().width;
    const minimo = 300;
    const move = (ev) => {
      const largura = Math.max(minimo, w0 + (ev.clientX - x0));
      alvo.style.flex = '0 0 ' + Math.round(largura) + 'px';
      alvo.style.minWidth = '0';
      guardarLarguraColuna(alvo);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      savePanes();
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  return s;
}

// devolve todos os chats da aba aberta ao tamanho padrao
// (mudar a largura reflui o texto: o ponto de leitura tem que ser guardado e devolvido junto)
function igualarChats(voltarProPrimeiro) {
  const A = abaAtiva; if (!A) return;
  semPerderRolagem(A, () => {
    for (const pid of A.ordem) {
      const q = panes.get(pid);
      if (q) { q.larguraColuna = 0; q.pesoAltura = 1; }
    }
    // so o duplo clique no divisor ("deixa todos iguais") volta a fila de chats pro primeiro;
    // fechar ou abrir um chat nao pode arrastar a tela de lado sem ele ter pedido
    remontarEspaco(A);
    if (voltarProPrimeiro) A.corpoEl.scrollLeft = 0;
  });
  savePanes();
}

/* O que voce ja mandou, pra trazer de volta com a seta pra cima (as 50 ultimas).
   No iPhone o setConfig e um faz-de-conta de proposito: la o historico e lido, mas o
   telefone nao grava por cima do config do Mac. */
function historicoPrompts() { return Array.isArray(cfg.prompts) ? cfg.prompts : []; }
function guardarPrompt(txt) {
  const t = String(txt || '').trim();
  if (!t) return;
  if (!Array.isArray(cfg.prompts)) cfg.prompts = [];
  const i = cfg.prompts.indexOf(t);
  if (i >= 0) cfg.prompts.splice(i, 1);   // repetido sobe pro fim em vez de duplicar
  cfg.prompts.push(t);
  while (cfg.prompts.length > 50) cfg.prompts.shift();
  window.api.setConfig(cfg);
}

let restaurando = false;
/* Abas que estavam no disco e que eu nao consegui remontar. Continuam sendo gravadas como
   estavam: sem isto, o primeiro salvamento depois de uma restauracao pela metade apagava do
   arquivo justamente as abas que faltaram — logo depois de o aviso dizer que nada foi perdido. */
let abasQueNaoVoltaram = [];
let clienteQueEstavaAberto = '';
/* `fechou` = esta gravacao PODE diminuir a lista de abas, porque foi ele quem fechou.
   Sem essa marca o Mac recusa a perda e devolve as abas que faltam (ver saveConfig no
   main.js). E a trava contra o defeito que comeu 108 abas: uma gravacao com o retrato
   incompleto da tela — boot, restauracao que falhou no meio, foto velha — apagava do
   arquivo as abas que ainda nao estavam montadas. */
function savePanes(fechou) {
  // todo vai-e-vem de chat passa por aqui: e o lugar certo pra acender/apagar a borda
  // das conversas que estao abertas na lista lateral
  marcarAbertas();
  if (restaurando) return;   // remontando a tela: nao gravar estado pela metade
  delete cfg.panes; delete cfg.grupos;
  const listaAbas = [...abas.values()];
  cfg.abas = listaAbas.map(A => ({
    cwd: A.cwd,
    ativo: Math.max(0, A.ordem.indexOf(A.ativo)),
    chats: A.ordem.map(pid => {
      const P = panes.get(pid); if (!P) return null;
      return {
        engine: P.engine, cwd: P.cwd, model: P.model, mode: P.mode, effort: P.effort,
        serviceTier: P.serviceTier, experimentalContext: P.experimentalContext,
        collaborationMode: P.collaborationMode,
        titulo: P.titulo, larg: P.larguraColuna ? '0 0 ' + P.larguraColuna + 'px' : '',
        /* de quem e o nome: sem guardar, reabrir o app esquecia que ele trocou o nome a mao (e a
           IA voltava a mexer) e parava de acompanhar a conversa que o Cockpit estava nomeando */
        nomeManual: P.nomeManual || undefined,
        nomeAuto: (!P.nomeManual && P.nomeDono && P.nomeDono === P.hist)
          ? { marco: P.nomeMarco || 0, curto: !!P.nomeCurto } : undefined,
        coluna: P.coluna, larguraColuna: P.larguraColuna, pesoAltura: P.pesoAltura,
        plano: P.plano || [], planoAberto: P.planoAberto,
        // guarda a conversa para ela voltar cheia, e nao uma caixa vazia
        sessao: P.sessaoId || P.resumeId || '',
        arquivo: P.sessaoFile || '',
        /* 25/09: trocou de IA e fechou o app antes de mandar a 1a mensagem: sem guardar, a
           conversa nova nasceria solta, sem costura com a de antes */
        parteAnterior: P.parteAnterior || undefined,
        /* ramo que ainda nao mandou a 1a mensagem (leva 8.3). Sem guardar, reabrir o app faria
           este chat virar CONTINUACAO da conversa de origem, escrevendo dentro dela. */
        fork: P.forkPendente || undefined,
        /* branch isolada (leva 10.5). Sem guardar, reabrir o app devolvia o chat para a pasta
           principal em silencio — e a proxima mensagem mexeria na branch de verdade. */
        worktree: P.worktree || undefined,
      };
    }).filter(Boolean),
  })).filter(a => a.chats.length).concat(abasQueNaoVoltaram);
  cfg.abaAberta = Math.max(0, listaAbas.indexOf(abaAtiva));
  // 'agrupou' e' fusao automatica no boot, nao clique dele: usa === pra nao confundir com fechou boolean
  const origemGravacao = fechou === true ? { fechou: true } : (fechou === 'agrupou' ? { agrupou: true } : null);
  Promise.resolve(window.api.setConfig(cfg, origemGravacao))
    .then(r => {
      if (r && (r.ok === false || r.error)) throw new Error(r.error || 'Não consegui salvar as conversas.');
      document.querySelector('[data-aviso="config-nao-salvou"]')?.remove();
      if (r && r.abasDevolvidas) avisarAbasGuardadas(r.abasDevolvidas);
    })
    .catch(e => mostrarAviso({ id: 'config-nao-salvou', tipo: 'erro', fixo: true,
      texto: (e.message || 'Não consegui salvar as conversas.') + ' Mantenha o Cockpit aberto para não perder estas abas.' }));
}

// o Mac barrou uma gravacao que ia comer aba: recado curto, so o numero
function avisarAbasGuardadas(devolvidas) {
  const total = (Array.isArray(cfg.abas) ? cfg.abas.length : 0) + devolvidas;
  mostrarAviso({ id: 'abas-guardadas', tipo: 'alerta', texto: 'Guardei suas ' + total + ' abas' });
}

/* ============ voltar como estava ============ */
/* A trava "restaurando" impede o app de salvar enquanto monta as abas de volta. Antes ela so
   era desligada no caminho feliz: se qualquer coisa estourasse no meio, ela ficava ligada e o
   savePanes() nunca mais gravava nada — em silencio. O Homero trabalhava o dia inteiro e no
   dia seguinte caia na tela de "Nova aba". O finally garante que ela sempre desliga. */
/* Uma aba = uma pasta de cliente. O que esta gravado pode ter chat de outro cliente dentro
   (arrastado na mao, aberto pela lista antes desta regra existir, ou pasta trocada depois):
   ao voltar, cada chat vai para a aba do SEU cliente e duas abas do mesmo cliente viram uma so.
   E o que impede a tela de abrir com "Matheus Mota" segurando uma conversa da pasta do Mac. */
function agruparPorCliente(salvas) {
  const mapa = new Map();
  const grupos = [];
  for (const a of salvas) {
    const chats = a.chats || [];
    const iAtivo = Math.min(Math.max(0, a.ativo | 0), chats.length - 1);
    chats.forEach((c, i) => {
      const cwd = c.cwd || a.cwd || HOME;
      const cli = clienteDe(cwd) || cwd;
      let g = mapa.get(cli);
      if (!g) { g = { cwd: cli, ativo: 0, chats: [] }; mapa.set(cli, g); grupos.push(g); }
      g.chats.push(Object.assign({}, c, { cwd }));
      if (i === iAtivo) g.ativo = g.chats.length - 1;
    });
  }
  return grupos;
}

async function restaurarAbas() {
  const gravadas = Array.isArray(cfg.abas) ? cfg.abas.filter(a => a && a.chats && a.chats.length) : [];
  if (!gravadas.length) return false;
  // qual cliente estava na frente, para reabrir nele mesmo depois do reagrupamento
  const antes = gravadas[Math.min(Math.max(0, cfg.abaAberta | 0), gravadas.length - 1)];
  clienteQueEstavaAberto = antes ? (clienteDe(antes.cwd || HOME) || antes.cwd) : '';
  const salvas = agruparPorCliente(gravadas);
  if (!salvas.length) return false;
  restaurando = true;
  abasQueNaoVoltaram = salvas.slice();     // cada aba que remontar sai desta lista
  let remontadas = 0;
  try {
    remontadas = await restaurarAbasCorpo(salvas);
  } finally {
    restaurando = false;
  }
  // R2-002: existia aba salva pra tentar restaurar, mas NENHUMA remontou — isso e falha total,
  // nao "0 abas porque nao tinha nada salvo". Sem isto o app abria sem aba nenhuma e sem
  // a tela de nova conversa, so o "+" pequeno da faixa funcionando, sem explicar nada.
  if (!remontadas) return false;
  /* Quando TODAS as abas gravadas voltaram, a lista pode legitimamente encolher: duas abas do
     mesmo cliente viram uma so (agruparPorCliente). Essa gravacao tem licenca pra diminuir.
     Se sobrou alguma que nao voltou, nao tem: ai a conta so pode cair por causa da falha, e o
     Mac guarda as abas de volta. */
  // nenhuma aba faltou: a conta so caiu por causa do agrupamento automatico, nao de um clique dele
  savePanes(abasQueNaoVoltaram.length ? false : 'agrupou');
  return true;
}

async function restaurarAbasCorpo(salvas) {
  const paraCarregar = [];
  let remontadas = 0;   // R2-002: conta quantas abas voltaram de verdade, pra restaurarAbas() saber se falhou tudo
  for (const a of salvas) {
    // cada aba isolada: uma aba com problema nao pode derrubar as seguintes
    let A;
    try {
    A = novaAbaProjeto(a.cwd || HOME);
    a.chats.forEach((c, i) => {
      const P = newPane({
        engine: c.engine, aba: A, cwd: c.cwd || a.cwd,
        model: c.model, mode: c.mode, effort: c.effort, titulo: c.titulo,
        serviceTier: c.serviceTier, experimentalContext: c.experimentalContext,
        collaborationMode: c.collaborationMode,
        coluna: c.coluna, pesoAltura: c.pesoAltura, plano: c.plano, planoAberto: c.planoAberto,
        larguraColuna: c.larguraColuna || Number((String(c.larg || '').match(/([\d.]+)px$/) || [])[1]) || 0,
      });
      // o nome volta com o dono: dado por ele fica intocado; o da IA continua acompanhando
      if (c.nomeManual) P.nomeManual = true;
      else if (c.nomeAuto && typeof c.nomeAuto === 'object' && c.titulo) {
        P.nomeDono = P.hist; P.nomeMarco = Number(c.nomeAuto.marco) || 0; P.nomeCurto = !!c.nomeAuto.curto;
      }
      // A largura antiga migrou para a coluna; a altura usa proporção.
      // ramo que fechou o app antes da 1a mensagem: continua sendo ramo (leva 8.3)
      if (c.fork) P.forkPendente = true;
      // chat que estava numa branch isolada volta nela (leva 10.5); o rotulo "⎇ nome" tem
      // de ser repintado aqui porque o newPane desenhou antes de saber do worktree
      if (c.worktree && !NA_VPS(c.cwd || a.cwd)) { P.worktree = c.worktree; mostrarPastaNoPainel(P); }
      /* 25/09: trocou de IA e fechou antes de mandar: a costura pendente volta junto */
      if (c.parteAnterior && c.parteAnterior.id) P.parteAnterior = c.parteAnterior;
      if (c.sessao) {
        P.carregandoHistorico = true;
        P.resumeId = c.sessao;                       // a proxima mensagem continua a mesma conversa
        // Sem repor tambem o caminho do arquivo, o primeiro savePanes() apos abrir gravava
        // arquivo:"" por cima do caminho salvo. Na reabertura seguinte o chat voltava VAZIO,
        // mesmo com a conversa inteira intacta no disco.
        P.sessaoFile = c.arquivo || '';
        /* 25/09: conversa costurada (trocou de IA no meio) volta INTEIRA: as partes de antes
           saem das ligacoes, e o painel continua na parte mais nova. Ramo pendente (c.fork)
           nao: o numero guardado e o da ORIGEM, e o ramo nao herda a costura dela. */
        const ref = { engine: c.engine, id: c.sessao, file: c.arquivo || '', cwd: c.cwd || a.cwd };
        const partes = c.fork ? [ref] : partesDaCadeia(ref);
        P.partesAnteriores = partes.slice(0, -1);
        paraCarregar.push({ P, arquivo: c.arquivo || '', id: c.sessao, cwd: c.cwd || a.cwd, revisao: P.revisaoConversa || 0, partes,
          // aba gravada antes de existir a marca do nome (ou aberta da lista sem dono): pergunta ao
          // nomes.json de quem e o nome, senao "Criacao Dupla" voltava e ficava para sempre
          semDono: (!c.nomeManual && !c.nomeAuto && c.titulo) ? c.titulo : '' });
      } else if (P.parteAnterior) {
        /* so a parte de antes da troca, ainda sem a conversa do motor novo: a tela volta com o
           que ja foi conversado e a proxima mensagem leva o contexto, como antes de fechar */
        P.carregandoHistorico = true;
        const partes = partesDaCadeia(P.parteAnterior);
        P.partesAnteriores = partes.slice(0, -1);
        paraCarregar.push({ P, revisao: P.revisaoConversa || 0, partes, soAntes: true });
      }
      pintarNome(P);
    });
    const iAtivo = Math.min(Math.max(0, a.ativo | 0), A.ordem.length - 1);
    const Pativo = panes.get(A.ordem[iAtivo]);
    if (Pativo) A.ativo = Pativo.id;
    // esta aba voltou: sai da lista das que precisam ser preservadas as cegas
    abasQueNaoVoltaram = abasQueNaoVoltaram.filter(x => x !== a);
    remontadas++;   // R2-002: conta a aba que remontou de verdade
    } catch (e) {
      console.error('nao consegui remontar a aba', a && a.cwd, e);
      // a aba quebrou no meio: desfaz o que ela ja criou. Sem isto ela fica viva pela metade
      // NA TELA e, como abasQueNaoVoltaram guarda a copia crua intacta, a mesma pasta sai
      // duplicada no proximo config.json (savePanes concatena as duas sem checar)
      if (A) {
        for (const [pid, P] of panes) {
          if (P.aid !== A.id) continue;
          P.el.remove();
          panes.delete(pid);
        }
        A.ordem = [];
        removerAbaVazia(A);
      }
    }
  }

  const abertas = [...abas.values()];
  // depois do reagrupamento o numero da aba mudou de lugar: quem manda e o cliente que estava aberto
  const iCli = clienteQueEstavaAberto
    ? abertas.findIndex(A => clienteDe(A.cwd) === clienteQueEstavaAberto) : -1;
  const i = iCli >= 0 ? iCli : Math.min(Math.max(0, cfg.abaAberta | 0), abertas.length - 1);
  ativarAbaProjeto(abertas[i] || abertas[0]);

  /* R2-001: cada conversa busca o historico em paralelo (Promise.all de funcoes independentes),
     nao mais uma de cada vez. Antes, um "for...of" com await sequencial fazia QUALQUER aba do
     Mac que estivesse depois de uma aba da VPS na lista esperar a VPS estourar o tempo (ate
     ~12s de ConnectTimeout SSH, ou o codexReq do Codex remoto) antes de sequer comecar a
     carregar, mesmo sem nenhuma relacao com a VPS. */
  await Promise.all(paraCarregar.map(async ({ P, arquivo, id, cwd, revisao, partes, soAntes, semDono }) => {
    if (!painelAindaAtual(P, revisao)) return;
    note(P, 'Trazendo a conversa de volta…');
    try {
      if (partes && (partes.length > 1 || soAntes)) {
        // 25/09: a cadeia inteira, da parte mais velha para a mais nova, com a faixa da troca
        const lidas = await lerPartes(partes);
        if (!painelAindaAtual(P, revisao)) return;
        const aviso = $('.note', P.chat); if (aviso) aviso.remove();
        const desenhou = desenharPartes(P, lidas);
        if (soAntes && desenhou) {
          // o motor novo ainda nao abriu a conversa dele: a faixa da troca e o contexto voltam
          const ultima = partes[partes.length - 1];
          if (ultima.engine !== P.engine) marcaTroca(P, nomeDoMotor(ultima.engine), nomeDoMotor(P.engine));
          if (!P.passarContexto && P.hist.length) P.passarContexto = montarContexto(P);
        }
        $$('.tool-st.run', P.el).forEach(x => { x.className = 'tool-st ok'; x.innerHTML = ico('check'); });
        if (desenhou) { clearEmpty(P); note(P, '— daqui pra baixo é a conversa de agora —'); }
        scroll(P, true);
        return;
      }
      // manda tambem id e pasta: quando o caminho se perdeu (config antigo), o main
      // reconstroi sozinho a partir deles em vez de devolver conversa vazia
      // conversa do Claude que rodou na VPS: o .jsonl esta LA, nao no disco daqui
      const msgs = (P.engine === 'claude' && NA_VPS(cwd) && window.api.sessionHistoryRemoto)
        ? await window.api.sessionHistoryRemoto({ id })
        : await window.api.sessionHistory({ engine: P.engine, file: arquivo, id, cwd });
      if (!painelAindaAtual(P, revisao)) return;
      const aviso = $('.note', P.chat); if (aviso) aviso.remove();
      for (const m of (msgs || [])) renderizarHistorico(P, m);
      $$('.tool-st.run', P.el).forEach(x => { x.className = 'tool-st ok'; x.innerHTML = ico('check'); });
      // sem isto o "Escreva embaixo pra começar" ficava por cima da conversa que acabou de voltar
      if (msgs && msgs.length) { clearEmpty(P); note(P, '— daqui pra baixo é a conversa de agora —'); }
      scroll(P, true);
    } catch { if (painelAindaAtual(P, revisao)) note(P, 'Não consegui trazer o que já foi conversado. Pode continuar mesmo assim.', true); }
    finally {
      if (painelAindaAtual(P, revisao)) P.carregandoHistorico = false;
      // depois do historico: o nome da IA continua a contagem de onde a conversa esta
      // (sem await: a restauracao nao espera por isso). No finally, e nao depois dele: a
      // conversa costurada (troca de IA) sai do try por um return e pulava esta linha.
      if (semDono) lembrarDonoDoNome(P, id, semDono, revisao);
    }
  }));
  return remontadas;   // R2-002: 0 quando NENHUMA aba salva conseguiu remontar
}

/* Por que só gemini e grok na segunda checagem: são os dois que podem faltar nesta máquina.
   O Claude e o Codex são a base do app, e apagar a base por causa de um PATH estranho seria
   trocar um aviso tardio por um app que não abre chat nenhum. É a mesma dupla que o
   avisarInstalacaoMotor já usa aqui embaixo. */
function motorIndisponivelNaPasta(engine, cwd) {
  // R2-016: o Grok roda pelo ACP, que o backend recusa na VPS igual ao Gemini — sem isto a
  // troca matava a conversa atual e so depois o backend recusava, na mensagem seguinte
  if ((engine === 'gemini' || engine === 'grok') && NA_VPS(cwd)) return nomeDoMotor(engine) + ' está disponível neste Mac. Escolha uma pasta do Mac para usar o ' + nomeDoMotor(engine) + '.';
  // na VPS quem roda é o motor DE LÁ: o que falta neste Mac não vem ao caso
  if (!NA_VPS(cwd) && ['gemini', 'grok'].includes(engine) && MOTORES_OK?.[engine] === false) {
    return nomeDoMotor(engine) + ' não está instalado neste Mac.';
  }
  return '';
}
function avisarInstalacaoMotor(P) {
  if (!NA_VPS(P.cwd) && ['gemini', 'grok'].includes(P.engine) && MOTORES_OK?.[P.engine] === false) {
    /* recado do APP, nao erro do agente: ia em VERMELHO dentro do chat, no lugar das falhas do
       motor — e num chat recem-aberto ele ainda comia a tela de "Escreva embaixo pra comecar",
       deixando so a linha vermelha. Vai na faixa de avisos da janela, que e feita pra isso. */
    mostrarAviso({ id: 'falta-motor-' + P.engine, tipo: 'alerta',
      texto: nomeDoMotor(P.engine) + ' não está instalado neste Mac' });
  }
}
/* Redesenho 26/09: os 4 com o logo oficial na cor de cada um (a cor do assistente fica SÓ no
   logo), sem título. Sem clique por perto (robô, atalho), nasce logo abaixo do nome da conversa. */
function menuMotores(P) {
  const m = novoMenu(P, $('.pane-nome:not(.vazio)', P.el) || '.pane-hd');
  m.classList.add('menu-motor');
  m.setAttribute('aria-label', 'Escolher assistente');
  for (const engine of MOTORES_VISIVEIS) {
    // redesenho 26/09: o motivo de não dar (frase inteira) sai da tela e vai para o balão; o item
    // fica com cara de desativado, mas o clique continua dando o aviso com o motivo, como antes
    const motivo = motorIndisponivelNaPasta(engine, P.cwd);
    const item = elItem({ nome: nomeDoMotor(engine), on: P.engine === engine, dica: motivo },
      () => trocarMotor(P, engine));
    if (motivo) { item.classList.add('mi-off'); item.setAttribute('aria-disabled', 'true'); }
    item.dataset.motor = engine;
    const logo = $('.mi-ic', item);
    logo.classList.add('mi-logo');
    logo.innerHTML = svgMotor(engine);
    m.appendChild(item);
  }
}

/* Perguntar ANTES de cortar o que esta em andamento — e SO quando ha o que perder.
   Trocar de motor e trocar de modo matam o processo que esta rodando, igual a fechar o chat.
   Fechar ja perguntava (closePane); esses dois nao perguntavam nada, e sao botoes no meio do
   cabecalho, faceis de acertar sem querer. Chat parado nao pergunta nada: pergunta a toa cansa
   e ele acaba clicando em "sim" sem ler. Mesmo texto e mesmo jeito de perguntar do fechar. */
function confirmarCorte(P, oQueVaiFazer) {
  if (!P || (!P.busy && !agTrabalhando(P))) return true;
  const nome = (P.titulo || '').trim().slice(0, 40) || 'este chat';
  return confirm('O ' + nomeDoMotor(P.engine) + ' está trabalhando em “' + nome + '”.\n\n'
    + oQueVaiFazer + ' joga fora o que ele está fazendo. Continuar mesmo assim?');
}

async function trocarMotor(P, novo) {
  // P.trocando trava o clique repetido: sem ele, clicar rapido nos dois lados fazia o segundo
  // clique ser engolido em silencio, e uma mensagem enviada nesse meio-tempo subia o motor errado.
  if (!MOTORES_VISIVEIS.includes(novo) || novo === P.engine || P.trocando) return;
  if (motorIndisponivelNaPasta(novo, P.cwd)) {
    avisoTemp(P, motorIndisponivelNaPasta(novo, P.cwd), true);
    return;
  }
  // um clique aqui mata o que estiver rodando e comeca conversa nova: pergunta antes de cortar
  if (!confirmarCorte(P, 'Trocar para o ' + nomeDoMotor(novo))) return;
  // trocar de motor reinicia o chat: o microfone não pode ficar ditando por cima da troca
  vozSoltar(P);
  const antigo = nomeDoMotor(P.engine);   // [EDITA 12.4] mesma coisa nos dois de sempre; o ACP deixa de virar "Claude"
  const velho = P.engine;
  const estavaPlanejando = velho === 'codex' ? P.collaborationMode === 'plan' : P.mode === 'plan';
  P.trocando = true;
  invalidarConversa(P);
  // so o recado no chat e imediato (e so texto, nao roteia evento nenhum)
  marcaTroca(P, antigo, nomeDoMotor(novo));
  /* R2-004: P.engine (e tudo que depende dele: busy, blocks, tools, model...) SO troca DEPOIS
     que o paneStop confirmar que o motor velho parou. O Codex espera ate 1.5s pela resposta do
     turn/interrupt antes de soltar o paneId — nessa janela o app-server dele ainda manda
     tool-start/tool-end/text-delta/turn-end pro MESMO paneId, e o switch de receberEventoPane
     so olha o paneId, nao o motor. Trocando P.engine cedo (como era antes), esses eventos
     atrasados do motor velho eram processados como se fossem do motor NOVO, que nem comecou —
     passo de ferramenta fantasma, "terminou" com o motor errado, ate notificacao errada.
     Enquanto o await esta pendente P.engine continua sendo o velho DE PROPOSITO: assim
     qualquer evento atrasado ainda cai certo no switch, como pertencente ao motor de antes. */
  try { await window.api.paneStop({ paneId: P.id, engine: velho }); } catch {}
  if (panes.get(P.id) !== P) { P.trocando = false; return; }   // painel fechou no meio da espera
  // Cada motor usa um tipo diferente de numero de conversa. O id do Claude nao existe no
  // Codex, e o id do Codex nao existe no Claude. Se ele atravessa a troca, o motor novo tenta
  // retomar uma conversa impossivel ("no rollout found" no Codex). A continuidade entre os
  // motores vem pelo contexto montado logo abaixo, nao pelo id do motor antigo.
  limparPlano(P); limparSugestoes(P);
  /* 25/09: guarda QUAL conversa vinha antes (motor, número, arquivo) para costurar com a do
     motor novo quando ele abrir a dele (evento 'sessao'). E o que faz a conversa continuar UMA
     so na lista, com o logo das duas IAs, em vez de dois pedaços perdidos em listas diferentes. */
  guardarParteAnterior(P);
  // trocar de motor comeca conversa nova daquele motor: nasce com o modelo e o esforço de PADRAO_NOVO
  P.engine = novo; P.started = false; P.model = modeloNovo(novo); P.effort = esforcoNovo(novo);
  // Modelos e comandos anunciados pelo agente antigo não pertencem ao próximo motor.
  P.acpInfo = null; P.acpComandos = []; P.acpModo = '';
  P.effectiveSettings = null; P.settingsPending = false;
  P.collaborationMode = estavaPlanejando ? 'plan' : 'default';
  if (novo === 'codex' && P.mode === 'plan') P.mode = 'manual';
  if (novo === 'claude' && estavaPlanejando) P.mode = 'plan';
  P.sessaoId = null; P.resumeId = null; P.sessaoFile = '';
  zerarContexto(P);          // conversa nova, e a janela do motor novo nem e a mesma
  // leva 8.3: o fio mudou de conversa — a intenção de ramificar não pode ir junto, senão a
  // próxima mensagem forkaria a conversa ERRADA, em silêncio
  P.forkPendente = false;
  // leva 10.5: a branch isolada é uma coisa do Claude (a flag -w é dele). Trocar de motor
  // devolve o chat à pasta principal, senão o rótulo "⎇ nome" ficaria mentindo no Codex
  P.worktree = '';
  // o processo velho ja confirmou que morreu: o chat deixa de estar ocupado e a fila morre com
  // ele. O texto que estava na fila volta para o campo, e a bolha dele sai da tela junto — senao
  // ele manda de novo e a mesma mensagem fica duas vezes na conversa.
  P.busy = false; escondePerm(P);
  // R2-004: faltava aqui — as outras 6 funcoes que resetam a conversa (conversaDaPastaNova,
  // send(), turn-end, openSession, novaConversa, "Limpar a tela") sempre zeram isto; sem isto um
  // text-delta atrasado do motor antigo podia casar com um bloco de resposta ainda vivo na tela.
  P.blocks.clear(); P.tools.clear();
  if (P.queued) { const q = P.queued; P.queued = null; devolverFilaAoCampo(P, q); }
  // try/finally: se qualquer coisa tropecar aqui no meio, a trava TEM de sair, senao o botao
  // de trocar de motor fica morto para sempre naquele chat
  try {
    pararTrabalho(P); limparPassos(P); limparContinuar(P);
    fillModels(P); paintEngine(P); pintarModo(P); setDot(P, 'off');
    if (P.hist.length) P.passarContexto = montarContexto(P);
    avisarInstalacaoMotor(P);
  } finally {
    P.trocando = false;
  }
  cfg.lastEngine = novo; window.api.setConfig(cfg);
  pintarUso(P); lerUso(P.engine); savePanes();   // nao zera o "ja fechei": ele nao pediu o aviso de volta
}

function montarContexto(P, retomada, motivo) {
  const LIM = 14000;
  const linhas = [];
  for (let i = P.hist.length - 1; i >= 0; i--) {
    const h = P.hist[i];
    const t = '### ' + h.quem + ':\n' + montarEnvio((h.texto || '').trim(), h.attachments);
    if (linhas.join('\n\n').length + t.length > LIM) break;
    linhas.unshift(t);
  }
  // retomada = a conexao caiu e o numero da conversa se perdeu. Aqui o risco nao e recomecar do
  // zero: e pegar carona no resumo de OUTROS chats da mesma pasta, que o arranque injeta sozinho.
  if (retomada) {
    // o motivo muda so a PRIMEIRA frase: trocar de plano para créditos nao e queda nenhuma,
    // e dizer que caiu fazia o motor pedir desculpas por um problema que nao existiu
    // primeira-tentativa: a conversa NUNCA chegou a começar (nenhuma resposta real ainda),
    // então não existe "queda" pra avisar nem "conversa até aqui" pra fingir — é só reenviar.
    if (motivo === 'primeira-tentativa') {
      // linhas vazio (nenhuma mensagem anterior com conteudo): so o aviso curto.
      // linhas com conteudo: o que foi pedido antes tem que ir junto, senao some pra sempre.
      if (!linhas.length) return 'A primeira tentativa não chegou a começar. Mandando de novo.\n\n';
      return 'A primeira tentativa não chegou a começar. Mandando de novo.\n\n'
        + '--- o que foi pedido antes ---\n' + linhas.join('\n\n') + '\n--- fim ---\n\n';
    }
    const abertura = motivo === 'troca-de-cobranca'
      ? 'ATENÇÃO: esta conversa está continuando numa sessão nova (a forma de cobrança/modelo mudou). '
      : 'ATENÇÃO: esta conversa caiu (limite de uso ou internet) e voltou como sessão nova. ';
    return abertura
      + 'IGNORE qualquer resumo de trabalhos anteriores, memória do projeto ou contexto de outras '
      + 'conversas que tenha vindo no início desta sessão: NADA daquilo é o que estávamos fazendo. '
      + 'O trabalho desta conversa é EXCLUSIVAMENTE o que está abaixo. Se o que está abaixo não '
      + 'for suficiente para saber onde paramos, pergunte antes de agir — não invente nem retome '
      + 'trabalho de outro chat.\n\n'
      + '--- esta conversa até aqui ---\n' + linhas.join('\n\n') + '\n--- fim ---\n\n'
      + 'Agora, o novo pedido:\n';
  }
  return 'Estou continuando uma conversa que vinha sendo tocada por outro assistente, no mesmo computador '
    + 'e na mesma pasta. Abaixo está o que já foi conversado. Assuma o trabalho daqui em diante, '
    + 'sem recomeçar do zero e sem repetir o que já foi feito.\n\n'
    + '--- conversa até aqui ---\n' + linhas.join('\n\n') + '\n--- fim da conversa anterior ---\n\n'
    + 'Agora, o novo pedido:\n';
}

function marcaTroca(P, de, para) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'troca';
  /* Redesenho 26/09: discreta, só "Claude › Codex" entre dois fios. A frase inteira (que era o
     próprio texto da marca) vai para o balão do mouse: nada de frase explicativa na tela. */
  d.innerHTML = '<span class="tr-de"></span>' + ico('chevron-right') + '<span class="tr-para"></span>';
  $('.tr-de', d).textContent = de;
  $('.tr-para', d).textContent = para;
  d.title = 'Daqui em diante quem responde é o ' + para + ' (antes era o ' + de + ')';
  P.chat.appendChild(d); scroll(P, true);
}

function fillModels(P) {
  const ms = modelosDe(P);
  // A lista de modelos do Codex vem do proprio Codex e demora a chegar. Ate la, modelosDe()
  // devolve uma lista de faz-de-conta com um item so, e o modelo que ele tinha escolhido nao
  // estava nela: era apagado e o vazio ia parar no config. Enquanto a lista de verdade nao
  // chega, so pinta; nao decide nada. Quando ela chega, fillModels roda de novo (linha do
  // codexModels().then) e a escolha certa aparece.
  const listaReal = P.engine !== 'codex' || !!(MODELOS_CODEX && MODELOS_CODEX.length);
  if (listaReal && !ms.find(m => m.id === P.model)) P.model = (ms.find(m => m.id === modeloNovo(P.engine)) || ms.find(m => m.padrao) || ms[0]).id;
  const ef = esforcosDe(P);
  if (listaReal && ef.length && !ef.find(e => e.id === P.effort)) P.effort = modeloAtual(P).padraoEffort || ef[Math.min(2, ef.length - 1)].id;
  /* pop-up de modelo do redesenho: "Opus 5.5 ⇅" (nome + setinhas). O cérebro continua no
     começo só para o celular, que mostra o botão sem o nome (lá o caixa.css esconde as setinhas;
     no Mac esconde o cérebro). */
  $('.p-model', P.el).innerHTML = ico('brain') + '<span>' + modeloAtual(P).nome + '</span>' + ico('updown');
  pintarControlesCodex(P);
  // chat ainda sem tokens: o "0k / 1000k" segue o modelo escolhido (a janela é por modelo)
  if (!P.tokens) pintarTokens(P);
}
function posicionarChave(P) {
  const faixa = $('.p-chave', P.el);
  const ativo = $('.ch-lado[data-motor="' + P.engine + '"]', faixa);
  if (!ativo || !faixa.clientWidth) return;
  const f = faixa.getBoundingClientRect(), a = ativo.getBoundingClientRect();
  if (a.left < f.left) faixa.scrollLeft -= f.left - a.left;
  else if (a.right > f.right) faixa.scrollLeft += a.right - f.right;
}

function paintEngine(P) {
  const vazio = $('.pe-logo', P.el);
  if (vazio) vazio.innerHTML = svgMotor(P.engine);
  // placeholder do redesenho: "Mensagem para Claude" (o nome de quem vai ler), não "Escreva aqui…"
  const campo = $('.p-input', P.el);
  if (campo) campo.placeholder = 'Mensagem para ' + nomeDoMotor(P.engine);
  posicionarChave(P);
  P.el.classList.toggle('eng-codex', P.engine === 'codex');
  P.el.classList.toggle('eng-claude', P.engine === 'claude');
  // O protocolo ACP permanece apenas nas sessões antigas.
  P.el.classList.toggle('eng-acp', P.engine === 'acp');
  for (const e of ['gemini', 'grok']) P.el.classList.toggle('eng-' + e, P.engine === e);
  let etiqueta = $('.motor-extra', P.el);
  if (P.engine === 'acp') {
    if (!etiqueta) { etiqueta = document.createElement('span'); etiqueta.className = 'motor-extra'; $('.p-chave', P.el).after(etiqueta); }
    etiqueta.textContent = nomeDoMotor(P.engine);
  } else if (etiqueta) etiqueta.remove();
  $$('.ch-lado', P.el).forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.motor === P.engine));
    // mesma marca da tela "Nova aba": motor que não existe nesta máquina fica apagado. O
    // clique segue ligado porque o trocarMotor é quem diz o porquê, em cima da caixa de texto.
    const naoDa = motorIndisponivelNaPasta(b.dataset.motor, P.cwd);
    b.classList.toggle('apagado', !!naoDa);
    b.title = naoDa || '';
  });
  pintarControlesCodex(P);
  if (P === focusPane) pintarCorFoco();
}
function setFocus(P) {
  if (!P) return;
  const A = abaDe(P);
  if (A) { A.ativo = P.id; if (abaAtiva !== A) ativarAbaProjeto(A); }
  if (window.SEM_ELECTRON) window.dispatchEvent(new CustomEvent('cockpit:foco', { detail: { paneId: P.id } }));
  // o chat recebeu foco: a resposta nova já foi vista, o ponto azul some (README, "Estados")
  if (P.nova) { P.nova = false; pintarPonto(P); }
  if (focusPane === P) return;
  focusPane = P;
  avisarQuemEspera();   // o chat que ele acabou de abrir nao precisa mais de tarja
  for (const q of panes.values()) q.el.classList.toggle('focus', q === P);
  loadTree(P.cwd);
  atualizarGit(P);   // leva 10.4: o chip do git segue o chat que está em foco
  $('#tbTitle').textContent = shortPath(P.cwd) + '  ·  ' + nomeDoMotor(P.engine);
  const pn = $('#projName'); if (pn) pn.textContent = nomePasta(P.cwd);
  pintarCorFoco();
  marcarAbertas();   // a conversa selecionada da lista é a do chat em foco: muda junto com ele
}
/* A borda das abas do topo segue a cor da IA do chat em foco (laranja no Claude, azul no
   Codex, verde no Gemini). Le o --accent ja resolvido do chat, entao tema novo vale sozinho. */
function pintarCorFoco() {
  const P = focusPane;
  const cor = P && getComputedStyle(P.el).getPropertyValue('--accent').trim();
  if (cor) document.documentElement.style.setProperty('--cor-foco', cor);
  else document.documentElement.style.removeProperty('--cor-foco');
}
/* Fechar um chat que esta TRABALHANDO joga a resposta fora e mata o comando no meio. Com o
   mouse ainda da pra perceber; com Cmd+W e um teclado no automatico, nao. Entao so pergunta
   quando ha trabalho em andamento — chat parado fecha direto, como sempre. */
/* Matar o motor deste chat sem deixar rastro. O processo morto NUNCA mais manda "terminou"
   (no Claude o close sai calado porque foi parada de proposito; no Codex o apontamento
   thread->painel some junto), entao quem zera o "ocupado", a fila e a tarja de permissao tem
   de ser a tela, aqui, na hora. Sem isto o chat ficava preso em "trabalhando..." para sempre
   e toda mensagem seguinte virava "Na fila". */
async function desligarMotor(P) {
  invalidarConversa(P);
  P.trocando = true;
  try { await window.api.paneStop({ paneId: P.id, engine: P.engine }); } catch {}
  finally { P.trocando = false; }
  P.started = false;
  P.busy = false;
  if (P.queued) { const q = P.queued; P.queued = null; devolverFilaAoCampo(P, q); }
  pararTrabalho(P); limparPassos(P); limparContinuar(P);
  escondePerm(P);
  setDot(P, 'off');
}

async function closePane(id, semPerguntar) {
  const P = panes.get(id); if (!P) return;
  if ((P.busy || agTrabalhando(P)) && !semPerguntar) {
    const nome = (P.titulo || '').trim().slice(0, 40) || 'este chat';
    if (!confirm('O ' + nomeDoMotor(P.engine) + ' está trabalhando em “' + nome + '”.\n\nFechar agora joga fora o que ele está fazendo. Fechar mesmo assim?')) return;
  }
  // o quadro branco e dono de UM painel so: fechar outro painel nao pode derrubar o desenho dele
  // (so depois do confirm: "Cancelar" nao pode deixar rastro de coisa fechada)
  if (window.Quadro && window.Quadro.aberto && window.Quadro.aberto() && window.Quadro.donoEh && window.Quadro.donoEh(P)) { try { window.Quadro.fechar(); } catch (_) {} }
  // mesma regra do Quadro: o painel "Time de agentes" e' dono de UM painel so; fechar esse
  // painel nao pode deixar a janela de agentes aberta mostrando um chat que ja nem existe mais
  if (agPaneAberto === P) { try { fecharPainelAgentes(); } catch (_) {} }
  // fechar o chat tem de apagar a luz do microfone: o processo do ditado é dele
  vozSoltar(P, { guardarTexto: true });
  // e a busca do "@" deste chat morre junto: sem isto ela voltava depois e tentava abrir o
  // menu num painel que ja nao esta mais na tela
  pararBuscaDeArquivos(P);
  soltarNavArquivos(P);
  const A = abaDe(P);
  // ANTES de tirar o painel do DOM: no instante em que ele sai, os que sobram ja alargam
  // e o texto reflui. Anotar depois disso seria anotar o estrago e devolve-lo fielmente.
  guardarAntesDeMexer([A], id);
  try {
    guardarFechado(P);   // fechou sem querer? dá para trazer de volta
    // terminal embutido aberto neste chat morre junto, senao sobra processo vivo escondido
    if (P.fecharTerminal) { const f = P.fecharTerminal; P.fecharTerminal = null; try { f(); } catch {} }
    // Parar o Codex pode levar ate 1,5s (ele espera o turn/interrupt) e na VPS vai por ssh.
    // O chat tem de sumir no clique: o processo principal termina de matar o turno sozinho.
    window.api.paneStop({ paneId: id, engine: P.engine }).catch(() => {});
    P.tamanhoObserver?.disconnect();
    P.el.remove(); panes.delete(id);
    marcarAbertas();          // fechou o chat: a borda da conversa na lista apaga junto
    if (focusPane === P) focusPane = null;
    if (!A) return;
    const i = A.ordem.indexOf(id);
    if (i >= 0) A.ordem.splice(i, 1);
    if (A.ativo === id) A.ativo = A.ordem[Math.max(0, i - 1)] || A.ordem[0] || null;
    if (!A.ordem.length) { fecharAba(A); return; }   // aba sem chat nenhum some junto
    remontarEspaco(A);
    pintarAba(A);
    const viz = panes.get(A.ordem[Math.max(0, i - 1)]) || panes.get(A.ordem[0]);
    if (viz) setFocus(viz);
    savePanes();
  } finally { guardaTravada = false; }   // saidas no meio (sem aba / aba vazia) tambem soltam
}
function pintarTokens(P) {
  pintarAnel(P);
  const el = $('.p-tokens', P.el);
  if (!el) return;
  /* Chat vazio (tela E6): "0k / 1000k" quando a janela do modelo é conhecida. A classe "vazio"
     deixa o painel.css mostrar esse zero SÓ enquanto o chat não tem nada: conversa restaurada
     ainda sem o aviso de tokens do motor não pode dizer "0k". Janela desconhecida: nada. */
  el.classList.toggle('vazio', !P.tokens);
  if (!P.tokens) {
    const j = janelaConhecida(P);
    el.textContent = j ? '0k / ' + Math.round(j / 1000) + 'k' : '';
    el.title = j ? 'Conversa vazia. Cabem ' + Math.round(j / 1000) + 'k palavras-token neste modelo.' : '';
    return;
  }
  /* Redesenho 26/09: o cabeçalho mostra só "312k / 1000k" em 11px (README, "Painel de chat").
     A barrinha azul saiu: o quanto já encheu é o anel da caixa de escrever (pintarAnel), e um
     segundo azul no cabeçalho brigava com o único botão azul da área. Número inteiro de k: a
     casa decimal só fazia o texto dançar a cada evento. */
  const usado = Math.round(P.tokens / 1000) + 'k';
  if (P.janela) {
    const pct = Math.min(100, Math.round((P.tokens / P.janela) * 100));
    el.textContent = usado + ' / ' + Math.round(P.janela / 1000) + 'k';
    el.title = 'A conversa já ocupa ' + usado + ' das ' + Math.round(P.janela / 1000)
      + 'k palavras-token que cabem neste modelo (' + pct + '%). Quando enche, a conversa é resumida.';
  } else {
    el.textContent = usado;
    el.title = 'Tamanho da conversa até agora.';
  }
}

/* Conversa NOVA no MESMO painel (trocou de motor, trocou a pasta, entrou ou saiu do worktree):
   o medidor de contexto tem de voltar ao zero junto com o resto. Sem isto o painel mostrava
   "390k / 1000k" e o anel no vermelho numa conversa que acabou de nascer e nao tem uma palavra
   — e os numeros so se corrigiam quando o motor novo mandasse o primeiro aviso, o que no Codex
   so acontece depois da resposta inteira. Pior: o "esta enchendo" mentia, e mandar resumir
   resumia uma conversa vazia. Painel NOVO nao precisa disto: ele ja nasce zerado. */
function zerarContexto(P) { P.tokens = 0; P.janela = 0; pintarTokens(P); }

/* O tamanho da janela só chega com o primeiro aviso de tokens do motor (o Claude manda no fim
   da resposta; o Codex, durante). Até lá o chat vazio ficava sem o "0k / 1000k" do desenho.
   Então o app GUARDA o que cada motor já disse de cada modelo (cfg.janelas, "motor|modelo") e
   usa isso até o motor falar de novo. Modelo "[1m]" é 1 milhão pelo próprio nome. Fora disso
   (o Gemini e o Grok nunca dizem) fica sem número: melhor nada do que um tamanho chutado. */
const chaveJanela = (P) => P.engine + '|' + (P.model || '');
function lembrarJanela(P, janela) {
  if (!P || !janela || !cfg) return;
  cfg.janelas = cfg.janelas || {};
  const k = chaveJanela(P);
  if (cfg.janelas[k] === janela) return;   // só grava quando muda: o Codex avisa a cada passo
  cfg.janelas[k] = janela;
  try { Promise.resolve(window.api.setConfig(cfg)).catch(() => {}); } catch {}
}
function janelaConhecida(P) {
  if (P.janela) return P.janela;
  const guardada = cfg && cfg.janelas && cfg.janelas[chaveJanela(P)];
  if (guardada) return guardada;
  return /\[1m\]$/.test(P.model || '') ? 1000000 : 0;
}

async function compactarConversa(P) {
  if (P.busy) { avisoEnvio(P, 'Espere ele terminar para resumir a conversa.'); return; }
  P.busy = true; setDot(P, 'busy'); trabalhando(P, 'resumindo a conversa');
  const r = await window.api.paneCompactar({ paneId: P.id, engine: P.engine });
  if (r && r.error) {
    P.busy = false; setDot(P, 'idle'); pararTrabalho(P);
    avisoEnvio(P, 'Não deu para resumir: ' + r.error);
  }
}

function pintarAnel(P) {
  const bt = $('.p-compactar', P.el);
  if (!bt) return;
  const pct = (P.tokens && P.janela) ? Math.min(100, Math.round((P.tokens / P.janela) * 100)) : 0;
  /* Redesenho: no Mac o anel de 14 fica SEMPRE na barra (é assim no README, até com 0%). Só no
     celular, onde a fileira é apertada, ele continua sumindo abaixo de 20% — quem esconde é o
     caixa.css pela classe "baixo", não mais o "hidden". */
  bt.classList.remove('hidden');
  bt.classList.toggle('baixo', pct < 20);
  bt.classList.toggle('meio', pct >= 70 && pct < 90);
  bt.classList.toggle('cheio', pct >= 90);
  const volta = 2 * Math.PI * 6;   // r=6 no viewBox de 16 (o desenho do handoff)
  $('.an-fio', bt).style.strokeDashoffset = String(volta - (volta * pct) / 100);

  bt.title = 'A conversa já ocupa ' + pct + '% do que cabe neste modelo.\n'
    + 'Clique para resumir e liberar espaço sem perder o fio.';
}

function setDot(P, state) {
  P.dotEstado = state;                 // o estado do motor; a espera pinta por cima dele
  P.el.classList.toggle('ocupado', state === 'busy');
  pintarPonto(P);
  { const A = abaDe(P); if (A) pintarAba(A); }
  $('.p-stop', P.el).classList.toggle('hidden', state !== 'busy');
  $('.p-send', P.el).disabled = false;   // dá para enviar durante o trabalho: vai pela fila ou entra nele
}

/* O ponto do cabeçalho do chat segue a MESMA regra da bolinha da aba: travado esperando ELE
   (permissão ou pergunta) fica vermelho e parado, e isso ganha de tudo. Quem pisca está
   trabalhando; quem está parado em vermelho está esperando ele. */
function pintarPonto(P) {
  if (!P || !P.el) return;
  const pt = $('.p-dot', P.el);
  if (!pt) return;
  const espera = estadoDoPainel(P).cls === 'espera';
  pt.className = 'p-dot dot ' + (espera ? 'espera' : (P.dotEstado || 'off'));
  /* "nova" é o último da fila (README: esperando > trabalhando > nova): só vale em chat parado.
     O painel.css desenha o ponto azul antes do nome a partir desta classe. */
  if (P.nova && !espera && P.dotEstado !== 'busy') pt.className += ' nova';
}

/* Resposta nova (README do redesenho, "Estados"): o turno acabou num chat que NÃO está em foco.
   Fica o ponto azul antes do nome até ele olhar para o chat (setFocus apaga). No chat em foco a
   resposta já está na frente dele: ponto ali seria ruído. Antes do redesenho o chat que
   respondeu ficava com o ponto verde de "parado"; o desenho novo trocou por "parado = nada" e
   "nova = azul", e só a metade do "nada" tinha chegado. */
function marcarRespostaNova(P) {
  if (P && P !== focusPane) P.nova = true;
}

/* ============ desenho das mensagens ============ */
function clearEmpty(P) { const e = $('.pane-empty', P.el); if (e) e.remove(); }
// conversa zerada: volta o estado vazio, só o logo do motor certo no meio (redesenho: sem frase)
function voltarVazio(P) {
  P.chat.innerHTML = '<div class="pane-empty"><div class="pe-logo"></div></div>';
  paintEngine(P);
}

const soNome = (c) => String(c || '').split('/').pop();
function fraseDoPasso(nome, arg) {
  const a = String(arg || '').replace(/\s+/g, ' ').trim();
  const curto = a.length > 70 ? a.slice(0, 70) + '…' : a;
  const f = fraseCrua(nome, a, curto);
  f.nome = nome;
  f.cmd = comandoDoPasso(nome, String(arg || '').trim());   // o bloco "$ ..." que abre
  return f;
}
/* O bloco aberto do passo e "$ comando" (redesenho de 26/09). No Terminal e o comando que
   rodou, letra por letra (nada de trocar o caminho por "~": dentro de aspas o shell nao expande
   o til, e o comando copiado dali quebraria). Ler e buscar nao rodam comando nenhum: viram o
   equivalente de terminal que o design mostra ("cat ~/…/index.html", "rg -n checkout"), com a
   pasta da casa como "~". O resto (link, pesquisa, skill) nao e comando: vai sem o "$"
   (cmd.semCifrao) em vez de fingir um. */
const comTil = (p) => (HOME && (p === HOME || p.startsWith(HOME + '/')) ? '~' + p.slice(HOME.length) : p);
const aspasShell = (s) => (/^[\w@%+=:,./~-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");
function comandoDoPasso(nome, arg) {
  if (!arg) return { txt: '', semCifrao: true };
  if (nome === 'Bash' || nome === 'Terminal') return { txt: arg, semCifrao: false };
  if (nome === 'Read') {
    const c = comTil(arg);
    return { txt: 'cat ' + (c.startsWith('~/') ? '~/' + aspasShell(c.slice(2)) : aspasShell(c)), semCifrao: false };
  }
  if (nome === 'Grep') return { txt: 'rg -n ' + aspasShell(arg), semCifrao: false };
  return { txt: comTil(arg), semCifrao: true };
}
function fraseCrua(nome, a, curto) {
  switch (nome) {
    case 'Terminal': case 'Bash': return { txt: 'Terminal', det: curto };
    case 'Read': return { txt: 'Lendo', det: soNome(a) };
    case 'Write': return { txt: 'Criando', det: soNome(a) };
    case 'Edit': case 'Editando arquivo': return { txt: 'Editando', det: soNome(a) };
    case 'Grep': case 'Buscando no código': return { txt: 'Buscando', det: curto };   // "Buscando checkout" (o objeto ja diz o que)
    case 'Glob': case 'Procurando arquivos': return { txt: 'Procurando arquivos', det: curto };
    case 'WebSearch': case 'Pesquisando na web': return { txt: 'Pesquisando na web', det: curto };
    case 'WebFetch': case 'Abrindo link': return { txt: 'Abrindo a página', det: curto };
    case 'Task': case 'Agente': return { txt: 'Agente', det: curto };
    case 'TodoWrite': case 'Lista de tarefas': return { txt: 'Organizando tarefas', det: '' };
    case 'Skill': return { txt: 'Usando a skill', det: curto };
    default: return { txt: toolLabel(nome), det: curto };
  }
}

/* ---- execucao: cartao de comandos, no layout do Claude Code na web ----
   Redesenho de 26/09 (handoff do Claude Design, "Pensamento e grupo de passos"): o grupo e um
   disclosure — chevron de 12 ANTES do rotulo, "Executou 5 comandos" e o tempo que os comandos
   levaram. Aberto, os passos ficam recuados com uma guia de 1pt, sem cartao em volta. Cada
   passo e verbo + objeto (o objeto em mono) + chevron; o erro ganha o triangulo na frente. */
function grupoExec(P) {
  let g = P.execEl;
  if (!g || !g.isConnected) {
    g = document.createElement('div');
    g.className = 'exec';
    g.dataset.t0 = String(Date.now());          // de quando conta o "38s" do cabecalho
    g.innerHTML = '<button type="button" class="exec-hd" aria-expanded="false" title="Clique para ver os comandos">'
      + '<span class="exec-cv">' + ico('chevron-right') + '</span><span class="exec-nm2"></span>'
      + '<span class="exec-tempo"></span></button>'
      + '<div class="exec-card"></div>';
    $('.exec-hd', g).addEventListener('click', () => {
      const aberto = g.classList.toggle('aberto');
      $('.exec-hd', g).setAttribute('aria-expanded', String(aberto));
      $('.exec-hd', g).title = aberto ? 'Clique para esconder os comandos' : 'Clique para ver os comandos';
      scroll(P);
    });
    P.chat.appendChild(g);
    P.execEl = g;
  }
  return g;
}

// "38s", "1m 02s", "2m" (o jeito do design). Serve ao cabecalho do grupo, ao "Pensou por" e a
// linha do trabalhando.
function tempoCurto(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? m + 'm ' + String(r).padStart(2, '0') + 's' : m + 'm';
}
/* "Executou 5 comandos 38s": o tempo vai do primeiro passo ate o ultimo que terminou. Menos
   de 1s (conversa reaberta, em que os passos voltam todos de uma vez) nao mostra tempo nenhum
   em vez de mentir um "0s". Grupo em que tudo deu errado diz isso ("1 passo com erro"). */
function tituloGrupo(g) {
  const card = $('.exec-card', g);
  const n = card.children.length;
  const erros = card.querySelectorAll(':scope > .exec-it.erro').length;
  g.classList.toggle('solo', n === 1);
  $('.exec-nm2', g).textContent = erros && erros === n
    ? (n === 1 ? '1 passo com erro' : n + ' passos com erro')
    : (n === 1 ? 'Executou 1 comando' : 'Executou ' + n + ' comandos') + (erros ? ' · ' + erros + ' com erro' : '');
  const ms = Date.now() - Number(g.dataset.t0 || Date.now());
  const tempo = $('.exec-tempo', g);
  if (tempo) tempo.textContent = ms >= 1000 ? tempoCurto(ms) : '';
}

function passo(P, frase, id) {
  if (!P.busy) return;
  clearEmpty(P);
  const g = grupoExec(P);
  const card = $('.exec-card', g);
  const d = document.createElement('div');
  d.className = 'exec-it';
  if (id) d.dataset.id = id;
  // verbo (label-2) + objeto (mono, label-1) + chevron. O espaco entre os dois nao aparece na
  // tela (o flex ignora), mas vai junto quando ele copia a conversa com ⌘A ⌘C.
  d.innerHTML = '<div class="exec-t"><span class="exec-nm"><span class="exec-verbo"></span> <span class="exec-obj"></span></span>'
    + '<span class="exec-cv">' + ico('chevron-right') + '</span></div>'
    + '<div class="exec-bd"><div class="exec-cmd"><span class="exec-cifr">$</span>'
    + '<span class="exec-arg"></span></div><div class="exec-out"></div></div>';
  $('.exec-verbo', d).textContent = frase.txt;
  $('.exec-obj', d).textContent = frase.det || '';
  const cmd = frase.cmd && typeof frase.cmd === 'object' ? frase.cmd : { txt: frase.cmd || '', semCifrao: false };
  $('.exec-arg', d).textContent = cmd.txt || frase.det || frase.txt;
  // comando comprido corta com reticencias na tela (como no design): o inteiro fica no title
  $('.exec-cmd', d).title = cmd.txt || '';
  if (cmd.semCifrao) d.classList.add('sem-cifrao');
  $('.exec-t', d).addEventListener('click', () => { d.classList.toggle('aberto'); scroll(P); });
  card.appendChild(d);
  tituloGrupo(g);
  P.chat.appendChild(g);
  // a linha do "trabalhando" mostra o passo que esta rodando agora (verbo + objeto)
  (P.trabPassos = P.trabPassos || []).push({ id, verbo: frase.txt, obj: frase.det || '', nome: frase.nome || '' });
  P.trabFazendo = '';               // o texto de antes acabou: quando o passo terminar, e "Pensando"
  if (P.trabEl) { pintaTrab(P); P.chat.appendChild(P.trabEl); }
  scroll(P);
  return d;
}

function passoPronto(P, id, erro) {
  if (P.trabPassos && P.trabPassos.length) {
    const i = P.trabPassos.findIndex(x => x.id === id);
    if (i >= 0) { P.trabPassos.splice(i, 1); if (P.trabEl) pintaTrab(P); }
  }
  const g = P.execEl;
  if (!g) return;
  const d = [...$('.exec-card', g).children].reverse().find(x => x.dataset.id === id);
  if (d && erro && !d.classList.contains('erro')) {
    d.classList.add('erro');
    // passo com erro: triangulo na frente do verbo (forma + cor, nunca so a cor)
    $('.exec-t', d).insertAdjacentHTML('afterbegin', '<span class="exec-erro-ic">' + ico('warn') + '</span>');
  }
  tituloGrupo(g);
}

function limparPassos(P) { P.execEl = null; P.thinkEl = null; P.trabPassos = []; }

/* ===================== CONTINUAR A UM CLIQUE =====================
   Botão "Continuar" quando o chat esta parado e ja tem conversa; Enter no campo vazio manda o
   mesmo "continue". Nunca aparece com trabalho rodando nem com mensagem na fila.
   Redesenho (README, "Fim do turno"): ele saiu de dentro da caixa de escrever e mora na linha do
   fim do turno ("levou 2m · ver mudanças · Continuar"). Turno curto que não deixou essa linha
   ganha uma linha só dele, no mesmo formato, no fim da conversa. */
function podeContinuar(P) { return !!(P && !P.busy && !P.queued && P.hist && P.hist.length); }
function mostrarContinuar(P) {
  limparContinuar(P);
  if (!podeContinuar(P)) return;
  const chat = P.el && P.chat;
  if (!chat) return;
  const ult = chat.lastElementChild;
  const naLinha = !!(ult && ult.classList.contains('turno-fim'));
  // dentro da linha do turno: só o botão (sair dali não apaga a linha); sozinho: a linha inteira
  const box = document.createElement(naLinha ? 'span' : 'div');
  box.className = naLinha ? 'p-cont' : 'p-cont turno-fim';
  const bt = document.createElement('button');
  bt.className = 'cont-chip';
  // botão de 24 em --fill-2, só a palavra. O ▶ de texto saiu: símbolo de texto no lugar de
  // ícone era uma das sobras que o redesenho tira.
  bt.innerHTML = '<span>Continuar</span>';
  bt.title = 'Manda "continue" (Enter no campo vazio faz o mesmo)';
  bt.addEventListener('click', (e) => { e.stopPropagation(); enviarContinue(P); });
  box.appendChild(bt);
  (naLinha ? ult : chat).appendChild(box);
  scroll(P);
}
// o chip "Continuar" está dentro da parte da conversa que aparece agora (não rolou para fora)?
function chipNaVista(P, chip) {
  const r = chip.getBoundingClientRect();
  const c = (P.chat || chip.parentElement).getBoundingClientRect();
  return r.height > 0 && r.bottom > c.top && r.top < c.bottom;
}
function limparContinuar(P) {
  const b = P && P.el && $('.p-cont', P.el);
  if (b) b.remove();
}
function enviarContinue(P) {
  if (!podeContinuar(P)) return;
  const inp = P.el && $('.p-input', P.el);
  if (!inp || inp.value.trim()) return;   // tem texto escrito: nao atropela
  inp.value = 'continue';
  send(P);
}

/* ===================== ULTIMA FALA COMO LEGENDA =====================
   Num turno de 20 minutos a unica pista era o relogio: as frases de narracao do
   agente somem no rolar da tela. A ultima frase curta vira legenda do "trabalhando". */
function legendaDaFala(texto) {
  // o corpo de uma cerca de codigo fica de fora ("const x = 1;" nao e' legenda)
  const cauda = String(texto || '').slice(-600).replace(/```[\s\S]*?(```|$)/g, '');
  const linhas = cauda.split('\n')
    .filter((l) => !/^\s*(\||```|~~~)/.test(l))                      // linha de tabela e cerca de codigo nao sao legenda
    .map((l) => l.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')          // [texto](url) e ![alt](url) -> texto
      .replace(/^[\s#>*\-•\d.)]+/, '').replace(/[*_`~]/g, '').trim())
    .filter((l) => l.length > 2 && !/^[|:\-\s]+$/.test(l));
  const ult = linhas[linhas.length - 1] || '';
  return ult.length > 90 ? ult.slice(0, 88).trimEnd() + '…' : ult;
}
// diz se o texto INTEIRO (nao so a cauda) esta com uma cerca de codigo (```/~~~) aberta
// agora: bloco de codigo com mais de 600 caracteres sem linha em branco escapava da cauda
// e a ultima linha (crua) virava legenda por engano
function dentroDeCerca(texto) {
  const linhas = String(texto || '').split('\n');
  let dentro = false;
  for (const linha of linhas) if (/^\s{0,3}(```|~~~)/.test(linha)) dentro = !dentro;
  return dentro;
}
/* No local quem escreve a linha do "trabalhando" e o pintaTrab, de segundo em segundo:
   escrever direto no .trab-txt seria apagado no proximo tique. Entao aqui so guarda a
   legenda em P.trabOque e manda repintar. */
function legendarTrabalho(P, texto) {
  if (!P || !P.busy || !P.trabEl) return;
  if (dentroDeCerca(texto)) return;   // cerca aberta ha muito tempo: mantem a legenda anterior em vez de mostrar linha de codigo crua
  P.trabOque = legendaDaFala(texto);
  pintaTrab(P);
}

function trabalhando(P, oque) {
  if (!P.busy) return;              // terminou? entao nao mostra nada
  clearEmpty(P);
  let t = P.trabEl;
  if (!t || !t.isConnected) {
    /* Redesenho de 26/09: anel de 12 girando + verbo + objeto em mono + tempo tabular
       ("Lendo index.html 22s", "Escrevendo 4s"). Nada de "trabalhando" nem de logo pulsando:
       o anel ja diz que esta vivo. A legenda da ultima fala continua guardada em P.trabOque
       (a torre usa) e aparece no title da linha. */
    t = document.createElement('div');
    t.className = 'trab';
    t.innerHTML = '<span class="rd-anel trab-anel" aria-hidden="true"></span><span class="trab-txt"></span>'
      + '<span class="trab-obj"></span><span class="trab-tempo"></span>';
    P.chat.appendChild(t);
    P.trabEl = t;
    P.trabT0 = Date.now();
    P.trabFazendo = '';
    clearInterval(P.trabTimer);
    P.trabTimer = setInterval(() => pintaTrab(P), 1000);
  }
  if (oque !== undefined) P.trabOque = oque || '';
  if (oque) P.trabFazendo = oque[0].toUpperCase() + oque.slice(1);   // "pensando" -> "Pensando"
  pintaTrab(P);
  P.chat.appendChild(t);            // mantem sempre no fim
  scroll(P);
}
/* O que a linha diz, do mais concreto para o mais vago: o passo que esta rodando (o ultimo que
   comecou e ainda nao terminou), o texto sendo escrito, o recado de quem chamou (resumindo a
   conversa) e, no silencio entre uma coisa e outra, "Pensando".
   Com o time de agentes trabalhando e ele so esperando o time (nenhum passo proprio rodando,
   ou o passo que rodando e o proprio chamado do time), a linha diz "Coordenando 3 agentes":
   o "Pensando" ali mentia, parecia que so ele estava parado pensando. */
const PASSO_DO_TIME = new Set(['Task', 'Agent', 'Agente', 'Workflow']);
function verboDoTrabalho(P) {
  const rodando = (P.trabPassos || []).at(-1);
  if (rodando && !PASSO_DO_TIME.has(rodando.nome)) return { verbo: rodando.verbo, obj: rodando.obj };
  const time = P.agCartao;
  if (time && time.ativos && time.total) return { verbo: 'Coordenando', obj: time.total + (time.total === 1 ? ' agente' : ' agentes') };
  if (rodando) return { verbo: rodando.verbo, obj: rodando.obj };
  if (P.trabFazendo) return { verbo: P.trabFazendo, obj: '' };
  return { verbo: 'Pensando', obj: '' };
}
function pintaTrab(P) {
  const t = P.trabEl;
  if (!t || !t.isConnected) { clearInterval(P.trabTimer); P.trabTimer = null; return; }
  const s = Math.max(0, Math.round((Date.now() - (P.trabT0 || Date.now())) / 1000));
  const tempo = tempoCurto(s * 1000);
  const { verbo, obj } = verboDoTrabalho(P);
  $('.trab-txt', t).textContent = verbo;
  const o = $('.trab-obj', t); if (o) o.textContent = obj;
  const tp = $('.trab-tempo', t); if (tp) tp.textContent = tempo;
  t.title = P.trabOque || '';
  /* Um sinal por chat, e esperar por ele ganha de trabalhar (README do design): com o pedido
     de autorizacao ou a pergunta na tela, o anel girando embaixo da resposta dizia que o chat
     andava sozinho, quando ele esta parado esperando o clique. A linha so se esconde (o
     relogio continua contando) e volta sozinha quando ele responde. */
  t.classList.toggle('espera', estadoDoPainel(P).cls === 'espera');
}
function pararTrabalho(P) {
  clearInterval(P.trabTimer); P.trabTimer = null;
  if (P.trabEl) { P.trabEl.remove(); P.trabEl = null; }
}
function atBottom(P) { return P.chat.scrollHeight - P.chat.scrollTop - P.chat.clientHeight < 100; }
function scroll(P, force) {
  // aba no fundo nao tem altura: guardo para rolar quando ela aparecer, e marco que chegou coisa nova
  const A = abaDe(P);
  if (A && abaAtiva !== A) {
    P.precisaRolar = true;
    A.el.classList.add('nova');
    return;
  }
  if (force || atBottom(P)) P.chat.scrollTop = P.chat.scrollHeight;
}

function userMsg(P, text, anexos) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'msg user';
  /* redesenho 25/09: copiar, editar e voltar no tempo moram na MESMA linha do "Você", à
     esquerda dele (e não mais no pé da bolha). A barra já nasce aqui dentro: o barraDeAcoes
     acha ela e não cria outra embaixo. O .av (foto) continua no DOM para o pintarAvatar,
     mas o design só mostra "Você" — o CSS esconde. */
  d.innerHTML = '<div class="msg-role"><div class="msg-acoes"></div><span class="av"></span>Você</div>'
    + '<div class="msg-anx hidden"></div><div class="msg-body"></div>';
  pintarAvatar($('.av', d));
  if (anexos && anexos.length) {
    const cx = $('.msg-anx', d);
    cx.classList.remove('hidden');
    for (const a of anexos) cx.appendChild(fichaAnexo(a, false, null, P));
  }
  const corpo = $('.msg-body', d);
  corpo.textContent = text;
  // print colado sem uma palavra escrita: some com a bolha vazia que ficaria embaixo da fichinha
  if (!text) corpo.classList.add('hidden');
  // marca onde esta mensagem entra na fila de edições: é o que permite voltar no tempo
  d.dataset.edicoes = String((P.edicoes || []).length);
  d.dataset.hist = String(P.hist.length);
  botoesDaMinhaMensagem(P, d, text);
  P.chat.appendChild(d); scroll(P, true);
  P.hist.push({ quem: 'Você', texto: text, attachments: anexos || [] });
  return d;   // quem pinta a bolha da FILA precisa dela na mao para poder desfazer (ver marcarNaFila)
}

/* ---- a mensagem que ESPERA na fila ----
   Quando o motor esta ocupado, a bolha e pintada ANTES de a mensagem ter saido: e o que
   permite a ele ver o que escreveu. So que tres caminhos devolviam esse texto para o campo
   sem apagar a bolha nem tirar o item do historico — ele apertava Enter de novo e a MESMA
   mensagem aparecia duas vezes, com o historico duplicado junto. Agora a mensagem existe uma
   vez so: ou na tela (entregue), ou no campo (esperando). */
function marcarNaFila(P, d, texto) {
  if (!d) return;
  d.classList.add('esperando');
  /* o indice vem do proprio data-hist da bolha, que e mantido em dia quando algo sai do
     historico. Contar "P.hist.length - 1" aqui errava quando a resposta do motor entrava
     no historico entre pintar a bolha e marcar a fila. */
  const i = Number(d.dataset.hist);
  (P.filaMsgs = P.filaMsgs || []).push({ el: d, texto, iHist: Number.isFinite(i) ? i : P.hist.length - 1 });
}
function desmarcarFila(P) {
  for (const f of (P.filaMsgs || [])) if (f.el) f.el.classList.remove('esperando');
  P.filaMsgs = [];
}
/* tira do histórico o item de índice i e conserta o data-hist das mensagens seguintes
   (o data-hist e o que o "voltar no tempo" usa para achar o pedaco certo da conversa) */
function tirarDoHist(P, i) {
  P.hist.splice(i, 1);
  P.chat.querySelectorAll('.msg[data-hist]').forEach(el => {
    const n = Number(el.dataset.hist);
    if (n > i) el.dataset.hist = String(n - 1);
  });
}
/* apaga UMA bolha da tela e o item dela no historico. Serve para a bolha que nunca saiu:
   sem isto ela fica na tela e no P.hist, e o montarContexto manda a frase duas vezes. */
function tirarBolha(P, d) {
  if (!d) return;
  const i = Number(d.dataset.hist);
  if (d.parentNode) d.remove();
  if (Number.isFinite(i) && i >= 0 && P.hist[i]) tirarDoHist(P, i);
  if (P.filaMsgs) P.filaMsgs = P.filaMsgs.filter(f => f.el !== d);
}
function tirarBolhasDaFila(P) {
  const fila = P.filaMsgs || [];
  P.filaMsgs = [];
  const idx = [];
  for (const f of fila) {
    const i = f.el ? Number(f.el.dataset.hist) : f.iHist;
    if (f.el && f.el.parentNode) f.el.remove();
    if (Number.isFinite(i) && P.hist[i]) idx.push(i);
  }
  // de tras para a frente, senao a primeira remocao ja bagunca o indice da segunda
  idx.sort((a, b) => b - a);
  for (const i of idx) tirarDoHist(P, i);
}
function devolverFilaAoCampo(P, texto) {
  if (texto && typeof texto === 'object') {
    reporAnexos(P, texto.attachments || []);
    texto = texto.displayText == null ? (texto.text || '') : texto.displayText;
  }
  texto = String(texto || '');
  const cx = $('.p-input', P.el);
  if (cx) {
    tirarBolhasDaFila(P);
    cx.value = [texto, cx.value].filter(Boolean).join('\n\n');
    /* o 'input' aqui so serve para reajustar a altura do campo. Num comando de barra ("/graphify")
       ele acordava o menu de skills, que ESVAZIA o campo — o texto devolvido sumia na hora. */
    if (texto.startsWith('/') && !texto.includes(' ')) cx.style.height = 'auto';
    else cx.dispatchEvent(new Event('input'));
    window.dispatchEvent(new Event('cockpit:salvar-rascunhos'));
    return;
  }
  /* Sem campo disponível, a bolha informa que a mensagem não foi entregue. */
  for (const f of (P.filaMsgs || [])) if (f.el) { f.el.classList.remove('esperando'); f.el.classList.add('naoenviada'); }
  P.filaMsgs = [];
}

/* ---- na minha própria mensagem: corrigir e mandar de novo, ou voltar no tempo ---- */
function botoesDaMinhaMensagem(P, d, texto) {
  const barra = barraDeAcoes(d);
  const bEdit = document.createElement('button');
  bEdit.className = 'msg-bt'; bEdit.title = 'Corrigir e mandar de novo'; bEdit.innerHTML = ico('pencil');
  bEdit.onclick = () => editarMinhaMensagem(P, d, texto);
  const bCopia = botaoCopiar('Copiar o que eu escrevi', () => texto);
  const bVolta = document.createElement('button');
  bVolta.className = 'msg-bt'; bVolta.title = 'Voltar no tempo até aqui'; bVolta.innerHTML = ico('rewind');
  /* 26/09: sem o stopPropagation o mesmo clique subia até o document, cujo fecharMenus apagava o
     menu no instante em que ele abria: "Voltar no tempo" nunca aparecia (igual aos outros botões
     que abrem menu, que já paravam o clique) */
  bVolta.onclick = (e) => { e.stopPropagation(); menuVoltarNoTempo(P, d, texto); };
  barra.appendChild(bCopia); barra.appendChild(bEdit); barra.appendChild(bVolta);
}

function editarMinhaMensagem(P, d, texto) {
  if ($('.msg-edita', d)) return;
  const corpo = $('.msg-body', d);
  const cx = document.createElement('div');
  cx.className = 'msg-edita';
  cx.innerHTML = '<textarea class="me-txt"></textarea>'
    + '<div class="me-bts"><button class="me-x">Cancelar</button>'
    + '<button class="me-ok destaque">Mandar de novo</button></div>';
  const ta = $('.me-txt', cx);
  ta.value = texto;
  corpo.style.display = 'none';
  d.insertBefore(cx, corpo.nextSibling);
  const fim = () => { cx.remove(); corpo.style.display = ''; };
  $('.me-x', cx).onclick = fim;
  $('.me-ok', cx).onclick = () => {
    const novo = ta.value.trim();
    fim();
    if (!novo) return;
    /* bolha que NUNCA saiu (ficou marcada "nao enviada"): some antes de ir de novo, senao
       sobram duas iguais na tela e duas no P.hist. Em mensagem normal a antiga fica de
       proposito — ali mostrar as duas versoes e o esperado. */
    if (d.classList.contains('naoenviada')) tirarBolha(P, d);
    /* R3-029: bolha ainda "esperando" na fila (motor ocupado, ainda vai sair) — se nao tirar
       o texto velho de P.queued antes do send() de baixo, juntarNaFila GRUDA o corrigido em
       cima do errado (join '\n\n') e cria bolha nova, e o anexo original se perde porque
       P.anexos ja foi esvaziado no 1o envio. So da pra zerar P.queued com seguranca quando a
       fila tem SO essa mensagem: com 2+ na fila o texto de cada uma ja esta misturado dentro
       do mesmo P.queued, e apagar tudo perderia as outras — ai so tira a bolha mesmo. */
    else if (d.classList.contains('esperando') && P.filaMsgs && P.filaMsgs.length === 1 && P.filaMsgs[0].el === d) {
      if (P.queued && P.queued.attachments) reporAnexos(P, P.queued.attachments);
      P.queued = null;
      tirarBolha(P, d);
    } else if (d.classList.contains('esperando')) {
      tirarBolha(P, d);
    }
    const inp = $('.p-input', P.el);
    inp.value = novo;
    inp.dispatchEvent(new Event('input'));
    send(P);
  };
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.me-ok', cx).click(); }
    if (e.key === 'Escape') { e.preventDefault(); fim(); }
  });
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.style.height = Math.min(ta.scrollHeight + 4, 260) + 'px';
}

/* ---- voltar no tempo ----
   Desfazer o código é de verdade: cada edição guardou o antes e o depois, então basta
   aplicar o contrário, de trás para frente. Voltar a CONVERSA o motor não deixa (a sessão
   dele não anda para trás), então o que se faz é abrir um chat novo levando o que foi dito
   até aquele ponto — que é a ramificação. */
function menuVoltarNoTempo(P, d, texto) {
  const desde = Number(d.dataset.edicoes || 0);
  const feitas = (P.edicoes || []).slice(desde);
  const m = novoMenu(P);
  m.classList.add('menu-voltar');
  m.appendChild(tituloPopup('Voltar até aqui'));
  m.appendChild(subPopup('"' + texto.slice(0, 60).replace(/\s+/g, ' ') + (texto.length > 60 ? '…' : '') + '"'));
  // redesenho 26/09: na tela, só uma linha curta como no design ("Pergunta antes de cada ação");
  // a explicação inteira continua no balão do mouse
  m.appendChild(elItem({
    ic: 'rotate-cw',
    nome: 'Desfazer o código feito depois daqui',
    desc: !feitas.length ? 'Nada foi editado depois daqui'
      : feitas.length === 1 ? '1 edição para desfazer' : feitas.length + ' edições para desfazer',
    dica: 'aplica o contrário de cada edição feita depois desta mensagem, da última para a primeira',
  }, () => desfazerDaqui(P, feitas)));
  m.appendChild(elItem({
    ic: 'sparkles',
    nome: 'Ramificar a conversa a partir daqui',
    desc: 'Chat novo com o que foi dito até aqui',
    dica: 'abre um chat novo levando só o que foi dito até este ponto',
  }, () => ramificarDaqui(P, d)));
  m.appendChild(elItem({
    ic: 'git-branch',
    nome: 'Ramificar levando a conversa inteira',
    desc: 'Chat novo com a conversa toda',
    dica: 'chat novo que lembra de TUDO, não de um resumo. O de origem fica intacto',
  }, () => ramificarInteiro(P)));
}

async function desfazerDaqui(P, feitas) {
  if (!feitas.length) { avisoEnvio(P, 'Nada foi editado depois dessa mensagem.'); return; }
  let ok = 0; const problemas = [];
  // de trás para frente: a última edição é a primeira a sair, senão o texto não bate mais
  for (let i = feitas.length - 1; i >= 0; i--) {
    const ed = feitas[i];
    for (let j = (ed.partes || []).length - 1; j >= 0; j--) {
      const p = ed.partes[j];
      const r = await window.api.desfazerEdicao({ arquivo: ed.arquivo, antes: p.antes, depois: p.depois });
      if (r && r.ok) ok++; else problemas.push(nomePasta(ed.arquivo) + ': ' + ((r && r.error) || 'erro'));
    }
  }
  avisoTemp(P, ok + ' mudança(s) desfeita(s)' + (problemas.length ? ' · ' + problemas.length + ' não deu: ' + problemas[0] : ''));
}

function ramificarDaqui(P, d) {
  const ate = Number(d.dataset.hist || 0);
  const pedaco = P.hist.slice(0, ate + 1);
  const Q = novoChatNaAba(P.engine);
  if (!Q) return;
  Q.cwd = P.cwd;
  pintarPasta(Q, nomePasta(Q.cwd));
  Q.hist = pedaco.slice();
  Q.passarContexto = pedaco.map(h => '### ' + h.quem + ':\n' + (h.texto || '').trim()).join('\n\n');
  Q.titulo = 'Ramo de: ' + (P.titulo || 'conversa'); Q.nomeManual = true;
  pintarNome(Q);
  avisoTemp(Q, 'Este chat continua de onde aquela mensagem estava. O chat de origem segue intacto.');
  $('.p-input', Q.el).focus();
  savePanes();   // sem isto o ramo reabria com o cwd da aba, não o cwd de onde saiu
}

/* ---- ramificar de VERDADE (leva 8.3) ----
   O "Ramificar a partir daqui" acima leva um RESUMO colado: acima de umas 14 mil letras o
   resto se perde. Aqui o ramo é real, feito pelo próprio motor — o Claude abre com
   --resume + --fork-session e o Codex tem thread/fork —, então o chat novo lembra da conversa
   INTEIRA e o de origem continua intacto. Quando o motor não consegue, o resumo é a reserva. */
async function ramificarInteiro(P) {
  const id = P.sessaoId || P.resumeId;
  if (!id) { ramoDeReserva(P, 'esta conversa ainda não tem número no motor'); return; }
  /* R7: pasta na VPS. O fork de verdade acontece no MAC — no Claude o --fork-session iria por
     ssh para o CLI de lá (que pode ser velho demais e derrubar o painel no start) e no Codex o
     motor local não enxerga a conversa de lá. Cai direto na reserva do resumo, que sempre vale. */
  if (NA_VPS(P.cwd)) { ramoDeReserva(P, 'a conversa mora na VPS'); return; }
  if (P.engine === 'claude') { forkClaude(P, id); return; }
  let r = null;
  try { r = await window.api.sessaoFork({ engine: P.engine, id }); }
  catch (e) { r = { error: String(e && e.message || e) }; }
  if (r && r.id) { abrirRamo(P, r.id); return; }
  ramoDeReserva(P, (r && r.error) || 'sem resposta');
}

/* Claude: o fork acontece no LIGAR do painel novo (--resume + --fork-session). Até lá o painel
   guarda a intenção em forkPendente — e ela vai para a ficha também, senão fechar o app antes
   da 1ª mensagem faria o ramo virar CONTINUAÇÃO da conversa de origem, escrevendo dentro dela. */
function forkClaude(P, id) {
  const Q = novoChatNaAba(P.engine);
  if (!Q) return;
  Q.cwd = P.cwd;
  pintarPasta(Q, nomePasta(Q.cwd));
  Q.resumeId = id; Q.forkPendente = true;
  Q.titulo = 'Ramo de: ' + (P.titulo || 'conversa'); Q.nomeManual = true;
  pintarNome(Q);
  faixaDeRamo(Q, P);
  savePanes();
}

/* Codex: o fork JÁ aconteceu no motor; aqui o painel novo só retoma o número novo */
function abrirRamo(P, idNovo) {
  const Q = novoChatNaAba(P.engine);
  if (!Q) return;
  Q.cwd = P.cwd;
  pintarPasta(Q, nomePasta(Q.cwd));
  Q.resumeId = idNovo;
  Q.titulo = 'Ramo de: ' + (P.titulo || 'conversa'); Q.nomeManual = true;
  pintarNome(Q);
  faixaDeRamo(Q, P);
  savePanes();
}

/* reserva: o caminho antigo, com o resumo colado. Continua existindo de propósito. */
function ramoDeReserva(P, motivo) {
  if (!P.hist.length) { note(P, 'Ainda não há conversa para levar adiante.', true); return; }
  note(P, 'Não deu para ramificar de verdade (' + motivo + ') — vou levar só o resumo da conversa.', true);
  /* o ramificarDaqui corta na mensagem clicada; aqui o pedido é a conversa INTEIRA, então o
     ponto de corte é a última fala. Ele lê só o d.dataset.hist. */
  ramificarDaqui(P, { dataset: { hist: String(P.hist.length - 1) } });
}

function faixaDeRamo(Q, P) {
  clearEmpty(Q);   // a tela de "chat vazio" ocupa a altura toda e empurraria a faixa pra fora
  const d = document.createElement('div');
  d.className = 'troca'; d.innerHTML = '<span></span>';
  // na tela só o nome do ramo; o que ele significa fica no balão do mouse (redesenho 26/09)
  $('span', d).textContent = 'Ramo de “' + (P.titulo || 'conversa anterior') + '”';
  d.title = 'Ele lembra da conversa inteira; a tela começa daqui. Escreva pra continuar.';
  Q.chat.appendChild(d);
  const c = $('.p-input', Q.el); if (c) c.focus();
}
function pintarAvatar(el) {
  if (cfg.foto) el.innerHTML = '<img src="' + cfg.foto + '" alt="">';
  else el.innerHTML = ico('user');
}
function repintarAvatares() { $$('.msg.user .av').forEach(pintarAvatar); $('#fotoPrev') && pintarAvatar($('#fotoPrev')); }

/* Um rótulo (logo + nome) por RESPOSTA, como no design: a primeira fala depois da minha
   mensagem leva o rótulo, mesmo que venha depois de um passo ("Abriu 1 imagem"); as falas
   seguintes da mesma resposta (depois de mais passos, ou coladas na de cima, como na conversa
   reaberta) não repetem. Antes o rótulo saía em toda fala da conversa reaberta e sumia na
   primeira fala que vinha depois de um passo. Troca de IA no meio ganha rótulo de novo. */
function falaContinua(P) {
  const falas = P.chat && P.chat.querySelectorAll ? P.chat.querySelectorAll(':scope > .msg') : [];
  const ult = falas[falas.length - 1];
  return !!(ult && ult.classList.contains('bot') && ult.dataset.motor === P.engine);
}
function botBlock(P, key) {
  clearEmpty(P);
  const semNome = falaContinua(P);
  const d = document.createElement('div');
  d.className = 'msg bot' + (semNome ? ' emenda' : '');
  /* 25/09: numa conversa costurada o mesmo painel mostra respostas de IAs diferentes: o logo
     de cada resposta leva a cor da IA que respondeu, e nao a do motor atual do painel */
  d.dataset.motor = P.engine;
  d.innerHTML = (semNome ? '' : '<div class="msg-role"><span class="av">' + svgMotor(P.engine) + '</span>'
    + nomeDoMotor(P.engine) + '</div>') + '<div class="msg-body"></div>';   // [EDITA 12.4] o ACP dizia "Claude"
  P.chat.appendChild(d);
  const b = { el: $('.msg-body', d), raw: '', corte: 0, fixos: 0 };
  P.blocks.set(key, b); scroll(P);
  return b;
}
function thinkBlock(P) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'think'; d.innerHTML = '<div class="think-in"></div>';
  P.chat.appendChild(d);
  const b = { el: $('.think-in', d), raw: '' };
  P.blocks.set('__think', b); scroll(P);
  return b;
}
/* ---- desenhar a resposta enquanto ela chega ----
   Cada pedacinho de texto que chegava fazia o app refazer o markdown do bloco INTEIRO. Como a
   resposta so cresce, cada redesenho custava mais que o anterior: numa resposta de 40 KB o app
   refazia uns 2.000 pedacos de tela 20 vezes por segundo so pra mostrar mais 30 letras — e era
   o motivo principal de o Cockpit ir engasgando (rolar travando, digitar atrasado no chat do
   lado, cursor pulando).
   Agora o bloco tem duas partes. Linha em branco separa um paragrafo do outro no markdown,
   entao tudo que vem ANTES da ultima linha em branco nao muda mais: e desenhado UMA vez e
   fica quieto. So a PONTA (o trecho depois dela) e refeita a cada pedaco que chega, e ela e
   curta. No fim do turno o 'texto final' refaz o bloco inteiro de uma vez, entao o que fica
   na tela e exatamente o mesmo de antes. */

/* Bloco de codigo comprido e a unica ponta que cresce sem parar: linha em branco dentro do
   ``` nao fecha nada. Passando de 4 KB, a ponta passa a ser redesenhada 5 vezes por segundo
   em vez de 20 — o olho nao ve diferenca e o 'texto final' acerta tudo no fim. */
const PONTA_GRANDE = 4000, PAUSA_PONTA = 200;

/* Ate onde o texto ja fechou. So olha o pedaco que veio DEPOIS do ultimo corte: o que fechou
   nao muda mais. O que esta dentro de bloco de codigo (```) nao conta — la a linha em branco
   faz parte do codigo e o bloco so termina mais pra frente. */
function avancarFechado(b) {
  const linhas = b.raw.slice(b.corte).split('\n');
  let dentro = false, novo = b.corte, i = b.corte;
  for (let n = 0; n < linhas.length - 1; n++) {   // a ultima linha ainda pode estar crescendo
    const linha = linhas[n];
    if (/^\s{0,3}(```|~~~)/.test(linha)) dentro = !dentro;
    i += linha.length + 1;                        // +1 = o \n que o split comeu
    if (!dentro && !linha.trim()) novo = i;
  }
  if (novo > b.corte) b.corte = novo;
}

function pintarPonta(b) {
  const antes = b.corte;
  avancarFechado(b);
  if (b.corte > antes) {
    // fechou mais um pedaco: ele sai do lugar de ponta e vira parte fixa do bloco
    while (b.el.childNodes.length > b.fixos) b.el.removeChild(b.el.lastChild);
    b.el.insertAdjacentHTML('beforeend', marked.parse(b.raw.slice(antes, b.corte)));
    b.fixos = b.el.childNodes.length;
    b.pintadoEm = 0;                              // pedaco novo: pode redesenhar a ponta ja
  }
  const ponta = b.raw.slice(b.corte);
  const agora = Date.now();
  if (ponta.length > PONTA_GRANDE && agora - (b.pintadoEm || 0) < PAUSA_PONTA) return;
  b.pintadoEm = agora;
  while (b.el.childNodes.length > b.fixos) b.el.removeChild(b.el.lastChild);
  if (ponta.trim()) b.el.insertAdjacentHTML('beforeend', marked.parse(ponta));
}

function textDelta(P, key, text) {
  P.trabFazendo = 'Escrevendo';                     // a linha do trabalhando diz o que ele faz agora
  let b = P.blocks.get('resp');
  const depoisDeComando = P.execEl && P.execEl.isConnected;
  if (!b || P.blocks.get('respKey') !== key || depoisDeComando) {
    // texto que vem depois de comandos entra num bloco novo, abaixo do cartao
    if (b && !depoisDeComando) { b.raw = ''; b.el.innerHTML = ''; b.corte = 0; b.fixos = 0; }
    else { b = botBlock(P, 'resp'); }
    P.blocks.set('respKey', key);
    P.blocks.set('resp', b);
    P.execEl = null;                                  // proximo comando abre cartao novo
  }
  b.raw += text; pintarPonta(b);
  // marca a fala que ainda está chegando: o CSS põe o cursor de 7×15 no fim dela (some no textFinal)
  b.el.classList.add('chegando');
  // o texto ACUMULADO, nao o pedaco de 50ms que chegou agora: sozinho ele quase nunca
  // e uma frase inteira
  legendarTrabalho(P, b.raw);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
}
let ultimoPensar = 0;
function thinkDelta(P, text) {
  trabalhando(P, 'pensando');
  const agora = Date.now();
  if (agora - ultimoPensar > 8000) ultimoPensar = agora;
  pensamento(P, text, agora);
}
/* "Pensou por 6s" (redesenho de 26/09): o pensamento vira um disclosure fechado, igual ao
   grupo de passos. Fechado, e so a linha; aberto, o texto dele recuado com a guia de 1pt.
   O mesmo bloco serve ao turno inteiro enquanto so passos vieram depois dele (pensa, roda,
   pensa de novo = um "Pensou por" so, em cima do "Executou"); texto da resposta no meio abre
   um bloco novo embaixo dele. O texto so e escrito na tela com o bloco aberto: o pensamento
   chega em pedacinhos, e pintar cada um fechado seria trabalho jogado fora. */
function pensamento(P, text, agora) {
  if (!P.busy) return;
  let d = P.thinkEl;
  let vale = !!(d && d.isConnected);
  for (let n = vale ? d.nextElementSibling : null; vale && n; n = n.nextElementSibling)
    if (!n.classList.contains('exec') && !n.classList.contains('trab')) vale = false;
  if (!vale) {
    clearEmpty(P);
    d = document.createElement('div');
    d.className = 'think';
    d.innerHTML = '<button type="button" class="think-hd" aria-expanded="false" title="Clique para ver o que ele pensou">'
      + '<span class="think-cv">' + ico('chevron-right') + '</span><span class="think-nm"></span></button>'
      + '<div class="think-in"></div>';
    d._ms = 0; d._ultimo = 0; d._raw = '';
    $('.think-hd', d).addEventListener('click', () => {
      const aberto = d.classList.toggle('aberto');
      $('.think-hd', d).setAttribute('aria-expanded', String(aberto));
      if (aberto) $('.think-in', d).textContent = d._raw;
      scroll(P);
    });
    P.chat.appendChild(d);
    P.thinkEl = d;
    if (P.trabEl) P.chat.appendChild(P.trabEl);
  }
  // so soma o pensamento corrido: um buraco de mais de 3s entre dois pedacos foi outra coisa
  if (d._ultimo && agora - d._ultimo < 3000) d._ms += agora - d._ultimo;
  d._ultimo = agora;
  d._raw += String(text || '');
  if (d._raw.length > 40000) d._raw = d._raw.slice(-40000);
  $('.think-nm', d).textContent = 'Pensou por ' + tempoCurto(Math.max(1000, d._ms));
  if (d.classList.contains('aberto')) $('.think-in', d).textContent = d._raw;
  scroll(P);
}
/* ---- buscar DENTRO da conversa aberta (⌘F) ----
   Conversa de tres horas so se navegava rolando. Aqui as ocorrencias sao marcadas de amarelo
   e o Enter pula de uma para a outra. Nao usa o buscador do Chrome porque ele procura na tela
   inteira: acharia coisa nos outros chats abertos ao lado. */
const NAO_ENTRAR = ['SCRIPT', 'STYLE', 'MARK', 'INPUT', 'TEXTAREA', 'BUTTON', 'SVG'];

function limparAchados(P) {
  if (!P.achados || !P.achados.length) { P.achados = null; return; }
  for (const m of P.achados) {
    const pai = m.parentNode;
    if (!pai) continue;
    pai.replaceChild(document.createTextNode(m.textContent), m);
    pai.normalize();
  }
  P.achados = null; P.achouI = -1;
}

function buscarNaConversa(P, termo) {
  limparAchados(P);
  const t = (termo || '').trim();
  const marcas = [];
  if (t) {
    const alvo = t.toLowerCase();
    const andar = (no) => {
      for (const f of [...no.childNodes]) {
        if (f.nodeType === 3) {
          const txt = f.textContent, baixo = txt.toLowerCase();
          let i = baixo.indexOf(alvo);
          if (i < 0) continue;
          const frag = document.createDocumentFragment();
          let ult = 0;
          while (i >= 0) {
            if (i > ult) frag.appendChild(document.createTextNode(txt.slice(ult, i)));
            const m = document.createElement('mark');
            m.className = 'acha'; m.textContent = txt.slice(i, i + t.length);
            frag.appendChild(m); marcas.push(m);
            ult = i + t.length;
            i = baixo.indexOf(alvo, ult);
          }
          if (ult < txt.length) frag.appendChild(document.createTextNode(txt.slice(ult)));
          f.parentNode.replaceChild(frag, f);
        } else if (f.nodeType === 1 && !NAO_ENTRAR.includes(f.tagName)) andar(f);
      }
    };
    andar(P.chat);
  }
  P.achados = marcas;
  P.achouI = marcas.length ? 0 : -1;
  irAoAchado(P, 0);
}

function irAoAchado(P, passo) {
  const lista = P.achados || [];
  const cx = $('.pb-conta', P.el);
  if (!lista.length) { if (cx) cx.textContent = P.buscaTermo ? 'nada' : ''; return; }
  P.achouI = ((P.achouI + passo) % lista.length + lista.length) % lista.length;
  lista.forEach((m, i) => m.classList.toggle('agora', i === P.achouI));
  lista[P.achouI].scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (cx) cx.textContent = (P.achouI + 1) + ' de ' + lista.length;
}

/* Com a busca aberta a conversa ganha uma folga no topo (painel.css): a barra flutua em cima
   da conversa e cobria a 1ª mensagem, com os botões Copiar, Corrigir e Voltar no tempo dela, sem
   jeito de rolar para tirar de baixo numa conversa curta. Quem está no MEIO da conversa não
   pode ver o texto pular: a rolagem anda o mesmo tanto que a folga. No topo não compensa, que é
   onde a folga tem de aparecer. No celular a busca fica no fluxo e a folga é zero. */
function mostrarBarraBusca(P, barra, mostrar) {
  const folga = () => parseFloat(getComputedStyle(P.chat).paddingTop) || 0;
  const antes = folga();
  barra.classList.toggle('hidden', !mostrar);
  const delta = folga() - antes;
  if (delta && P.chat.scrollTop > 0) P.chat.scrollTop += delta;
}
function abrirBuscaConversa(P) {
  if (!P) return;
  let barra = $('.p-busca', P.el);
  if (!barra) {
    barra = document.createElement('div');
    barra.className = 'p-busca hidden';   // nasce escondida: quem mostra é o mostrarBarraBusca, que mede a folga
    barra.innerHTML = '<span class="pb-ic">' + ico('search') + '</span>'
      + '<input class="pb-inp" placeholder="Buscar" spellcheck="false">'
      + '<span class="pb-conta"></span>'
      + '<button class="pb-bt" data-vai="-1" title="Anterior">' + ico('chevron-up') + '</button>'
      + '<button class="pb-bt pb-baixo" data-vai="1" title="Próximo">' + ico('chevron-down') + '</button>'
      + '<button class="pb-bt pb-x" title="Fechar (Esc)">' + ico('x') + '</button>';
    P.chat.parentElement.insertBefore(barra, P.chat);
    const inp = $('.pb-inp', barra);
    let timer = 0;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      P.buscaTermo = inp.value;
      timer = setTimeout(() => buscarNaConversa(P, inp.value), 160);
    });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); irAoAchado(P, e.shiftKey ? -1 : 1); }
      if (e.key === 'Escape') { e.preventDefault(); fecharBuscaConversa(P); }
    });
    $$('.pb-bt[data-vai]', barra).forEach(b => b.onclick = () => irAoAchado(P, Number(b.dataset.vai)));
    $('.pb-x', barra).onclick = () => fecharBuscaConversa(P);
  }
  mostrarBarraBusca(P, barra, true);
  const inp = $('.pb-inp', barra);
  inp.focus(); inp.select();
}

function fecharBuscaConversa(P) {
  const barra = $('.p-busca', P.el);
  if (barra) mostrarBarraBusca(P, barra, false);
  P.buscaTermo = '';
  limparAchados(P);
  $('.p-input', P.el).focus();
}

/* ---- o cerebro preferido de cada pasta ----
   Cliente pesado merece Opus, rascunho nao. Escolher na mao toda vez fazia ele cair no modelo
   errado e queimar limite a toa. A escolha fica colada na PASTA (e no motor), nao no chat. */
function chaveDaPasta(P) { return (P.cwd || '') + '|' + P.engine; }
function lembrarEscolhaDaPasta(P) {
  if (!P.cwd) return;
  cfg.porPasta = cfg.porPasta || {};
  cfg.porPasta[chaveDaPasta(P)] = { model: P.model || '', effort: P.effort || '' };
  window.api.setConfig(cfg);
}
function aplicarEscolhaDaPasta(P) {
  /* Claude e Codex nascem SEMPRE no PADRAO_NOVO (pedido de 15/09/2026, "sempre"): a escolha da
     pasta passava por cima (o Pedro abria no Opus 1M e no Extra alto). Continua valendo para os
     outros motores; o que ja foi guardado em cfg.porPasta fica la, para dar para voltar. */
  if (PADRAO_NOVO[P.engine]) return false;
  const g = cfg.porPasta && cfg.porPasta[chaveDaPasta(P)];
  if (!g) return false;
  if (g.model && modelosDe(P).some(m => m.id === g.model)) P.model = g.model;
  if (g.effort && esforcosDe(P).some(e => e.id === g.effort)) P.effort = g.effort;
  fillModels(P);
  return true;
}

/* ---- a mesma pergunta nos outros motores (⌘D) ----
   Dava para abrir os motores lado a lado, mas a pergunta era digitada uma vez em cada.
   O par Claude/Codex estava CRAVADO aqui: num painel do Gemini o atalho abria um chat do
   Codex, e nao havia jeito de confrontar Gemini com Grok nem de perguntar aos quatro.
   Agora a pergunta vai para todos os outros motores JA ABERTOS nesta aba — que e o caso de
   sempre e continua sem clique nenhum. So quando nao ha nenhum outro aberto o app pergunta
   qual abrir, em vez de adivinhar errado. */
async function perguntarAosOutros(P) {
  const inp = $('.p-input', P.el);
  const texto = inp.value.trim();
  if (!texto) { avisoEnvio(P, 'Escreva a pergunta primeiro — ela vai para os outros motores.'); return; }
  const A = abaDe(P);
  // um por motor: dois chats do Codex abertos nao viram duas copias da mesma pergunta
  const jaAbertos = [];
  const vistos = new Set([P.engine]);
  if (A) for (const id of A.ordem) {
    const Q = panes.get(id);
    if (Q && Q !== P && !vistos.has(Q.engine)) { vistos.add(Q.engine); jaAbertos.push(Q.engine); }
  }
  if (jaAbertos.length) return mandarAosOutros(P, texto, jaAbertos);

  const podem = MOTORES_VISIVEIS.filter(m => m !== P.engine && !motorIndisponivelNaPasta(m, P.cwd));
  if (!podem.length) { avisoEnvio(P, 'Não há outro motor disponível nesta pasta.'); return; }
  if (podem.length === 1) return mandarAosOutros(P, texto, podem);
  const pop = abrirPopGlobal(inp);
  for (const m of podem) pop.appendChild(popItem({ nome: nomeDoMotor(m), ic: 'columns-2' }, () => mandarAosOutros(P, texto, [m])));
  pop.appendChild(elLinha());
  pop.appendChild(popItem({ nome: 'Todos', ic: 'columns-2' }, () => mandarAosOutros(P, texto, podem)));
}

/* Poe o mesmo texto no campo de cada motor da lista e manda todo mundo de uma vez.
   O chat que falta e aberto aqui, na mesma pasta do painel de origem — pasta diferente da
   resposta diferente, e ai a comparacao nao vale nada. */
async function mandarAosOutros(P, texto, motores) {
  const A = abaDe(P);
  const destinos = [];
  for (const m of motores) {
    let Q = A ? A.ordem.map(id => panes.get(id)).find(q => q && q !== P && q.engine === m) : null;
    if (!Q) {
      Q = novoChatNaAba(m);
      if (!Q) continue;                  // motor que nao da nesta pasta ja avisou o motivo
      Q.cwd = P.cwd;                     // todos olham a MESMA pasta, senao a resposta muda
      pintarPasta(Q, nomePasta(Q.cwd));
      aplicarEscolhaDaPasta(Q);
    }
    const outroInp = $('.p-input', Q.el);
    outroInp.value = texto;
    outroInp.dispatchEvent(new Event('input'));
    destinos.push(Q);
  }
  if (!destinos.length) return;
  await send(P);
  for (const Q of destinos) await send(Q);
  setFocus(P);
}

/* ---- guardar a conversa no Obsidian ----
   Texto mora no vault, nao no chat. Copiar e colar na mao dava tanto trabalho que nunca ia. */
async function salvarConversaNoVault(P) {
  if (!P.hist.length) { avisoEnvio(P, 'Esta conversa ainda está vazia.'); return; }
  const linhas = P.hist.map(h => '## ' + (h.quem === 'Você' ? 'Homero' : h.quem) + '\n\n' + (h.texto || '').trim());
  const r = await window.api.salvarNoVault({
    titulo: (P.titulo || 'Conversa do Cockpit').trim(),
    cwd: P.cwd,
    motor: nomeDoMotor(P.engine),
    texto: linhas.join('\n\n'),
  });
  if (!r || r.error) { avisoEnvio(P, 'Não deu para salvar: ' + ((r && r.error) || 'erro')); return; }
  avisoTemp(P, 'Guardado no Obsidian em ' + r.curto);
}

/* ---- ditar em vez de digitar ----
   Roda no proprio Mac (whisper.cpp), sem internet e sem custo. Aperta, fala, solta. */
/* ============ ditar ============
   Dois modos. O de cima e o AO VIVO: quem ouve e o motor de fala do proprio Mac, e a fala vai
   aparecendo apagadinha dentro da caixa enquanto ele fala; quando ele para, o texto firma
   sozinho. O de baixo (whisper, grava tudo e transcreve no fim) fica de reserva para quando o
   ao vivo nao existir — Mac antigo, Windows, ou o programinha faltando. */
const VIVO = { P: null, base: '', firme: '', parcial: '' };

function vozFantasma(P) {
  let f = $('.p-fantasma', P.el);
  if (f) return f;
  f = document.createElement('div');
  f.className = 'p-fantasma hidden';
  f.innerHTML = '<span class="pf-firme"></span><span class="pf-parcial"></span>';
  $('.cmp-top', P.el).appendChild(f);
  return f;
}
function vozPintar(P) {
  const f = vozFantasma(P);
  const inp = $('.p-input', P.el);
  /* Digitou no campo no meio do ditado? O campo deixou de ser o que escrevemos por ultimo.
     Sem isto a legenda seguinte reescrevia tudo por cima e comia o que ele acabou de teclar.
     O que estiver escrito agora vira a nova base, e a fala continua a partir dali. */
  if (VIVO.ultimoEscrito != null && inp.value !== VIVO.ultimoEscrito) {
    VIVO.base = inp.value; VIVO.firme = ''; VIVO.parcial = '';
  }
  const firme = (VIVO.base ? VIVO.base.replace(/\s*$/, ' ') : '') + VIVO.firme;
  $('.pf-firme', f).textContent = firme;
  $('.pf-parcial', f).textContent = (firme && VIVO.parcial ? ' ' : '') + VIVO.parcial;
  f.classList.remove('hidden');
  // a caixa de verdade fica invisivel por baixo, para o cursor e a altura continuarem certos
  inp.classList.add('mudo');
  inp.value = firme + (VIVO.parcial ? (firme ? ' ' : '') + VIVO.parcial : '');
  VIVO.ultimoEscrito = inp.value;   // o que ficar diferente disto foi ele que digitou
  inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
  // fala longa passa da altura maxima: as duas camadas tem de rolar juntas, senao o que ele ve
  // (a de cima) congela no comeco enquanto a de baixo ja esta no fim
  inp.scrollTop = inp.scrollHeight;
  f.scrollTop = f.scrollHeight;
}
function vozEncerrarTela(P, textoFinal) {
  const f = $('.p-fantasma', P.el);
  if (f) f.classList.add('hidden');
  const inp = $('.p-input', P.el);
  inp.classList.remove('mudo');
  const bt = $('.p-mic', P.el);
  if (bt) bt.classList.remove('gravando', 'pensando');
  if (textoFinal != null) {
    inp.value = textoFinal;
    inp.dispatchEvent(new Event('input'));
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }
}
// silencio puro faz o motor cuspir um "." sozinho: isso nao e fala, e nao pode entrar no texto
const vozVazio = (t) => !String(t || '').replace(/[\s.,;:!?…]/g, '');
// chega do motor: parcial (cinza), final (firma), status, erro
function vozEvento(P, ev) {
  if (VIVO.P !== P) return;
  // nível do microfone: enche a barrinha do botão e, no fim, explica por que não saiu texto
  if (ev.type === 'nivel') { vozNivel(P, ev); return; }
  if (ev.type === 'partial') {
    if (vozVazio(ev.text)) return;
    VIVO.parcial = ev.text || ''; vozPintar(P); return;
  }
  if (ev.type === 'final') {
    if (vozVazio(ev.text)) { VIVO.parcial = ''; return; }
    // sincroniza VIVO.base com o que foi digitado à mão ANTES do comando, senão "manda" envia
    // texto velho por cima de uma correção que ele acabou de teclar (vozPintar já faz esse sync)
    vozPintar(P);
    // a frase que fechou, quando é SÓ um comando ("manda", "cancela"), não vira texto: vira ação
    if (vozComando(P, ev.text)) return;
    VIVO.firme = (VIVO.firme ? VIVO.firme.replace(/\s*$/, ' ') : '') + String(ev.text || '').trim();
    VIVO.ultimo = String(ev.text || '').trim();   // o "apaga isso" precisa saber qual foi a última
    VIVO.parcial = ''; vozPintar(P); return;
  }
  if (ev.type === 'error') {
    const msg = String(ev.msg || '');
    vozEncerrarTela(P, (VIVO.base ? VIVO.base.replace(/\s*$/, ' ') : '') + VIVO.firme);
    VIVO.P = null;
    // motor de fala indisponivel (Mac antigo, idioma nao instalado): cai no ditado antigo
    vozTirarNivel(P);
    if (/macOS 26|idioma nao instalado|sem formato|conversor/.test(msg)) { ditadoWhisper(P); return; }
    // recado que ele consegue agir: onde fica a chave, e não o texto cru do programinha
    if (/permiss/i.test(msg)) { avisoEnvio(P, 'O Mac não deixou usar o microfone. Libere em Ajustes do Sistema › Privacidade e Segurança › Microfone.'); return; }
    avisoEnvio(P, 'Não consegui ouvir: ' + msg);
    return;
  }
  if (ev.type !== 'status') return;
  if (ev.msg === 'ouvindo') { const bt = $('.p-mic', P.el); if (bt) bt.classList.add('gravando'); return; }
  if (ev.msg === 'silencio' || ev.msg === 'teto de tempo') {
    const bt = $('.p-mic', P.el); if (bt) { bt.classList.remove('gravando'); bt.classList.add('pensando'); }
    return;
  }
  if (ev.msg === 'nao ouvi nada') VIVO.jaAvisou = true;   // já falamos com ele: o 'fim' não repete
  if (ev.msg === 'nao ouvi nada') { avisoTemp(P, 'Não ouvi nada. Clique no microfone e fale.'); return; }
  if (ev.msg === 'fim') {
    const texto = ((VIVO.base ? VIVO.base.replace(/\s*$/, ' ') : '') + VIVO.firme + (VIVO.parcial ? ' ' + VIVO.parcial : '')).trim();
    // nada saiu: dizer POR QUE (mudo, baixo demais, ou não entendi) em vez de deixar no vácuo.
    // Medido ANTES de zerar o VIVO, que é de onde vem o pico do microfone.
    const porque = (!VIVO.firme.trim() && !VIVO.parcial.trim()) ? vozDiagnostico(!!VIVO.jaAvisou) : '';
    vozEncerrarTela(P, texto);
    VIVO.P = null; VIVO.base = ''; VIVO.firme = ''; VIVO.parcial = '';
    VIVO.ultimo = ''; VIVO.nivel = 0; VIVO.picoGeral = 0; VIVO.jaAvisou = false;
    vozTirarNivel(P);
    if (porque) avisoTemp(P, porque);
  }
}
async function alternarDitado(P) {
  // ja esta ditando ao vivo aqui? entao o clique e para PARAR (e o texto fica)
  if (VIVO.P === P) { window.api.vozParar({ paneId: P.id }); return; }
  if (VIVO.P) { window.api.vozParar({ paneId: VIVO.P.id }); VIVO.P = null; }
  // R3-031: mesmo painel gravando = toggle de verdade (para e sai). Painel DIFERENTE grava-
  // dor de outro painel: para o antigo mas NAO sai, cai para ligar o novo aqui embaixo —
  // igual ja acontecia no bloco do VIVO.P acima. Sem isto o clique no microfone de B so
  // calava A e B nunca acendia.
  if (DITADO.rec && DITADO.P === P) { pararDitado(); return; }
  if (DITADO.rec) pararDitado();
  if (window.api.vozVivo) {
    VIVO.P = P; VIVO.base = $('.p-input', P.el).value || ''; VIVO.firme = ''; VIVO.parcial = '';
    // ditado novo comeca sem lembranca do que foi escrito no anterior, senao a guarda de
    // "digitou por fora" dispara logo na primeira legenda e come o primeiro pedaco da fala
    VIVO.ultimoEscrito = null;
    // ditado novo começa com o medidor no zero, senão o pico do anterior mentiria no diagnóstico
    VIVO.ultimo = ''; VIVO.nivel = 0; VIVO.picoGeral = 0; VIVO.jaAvisou = false;
    vozTirarNivel(P);
    const r = await window.api.vozVivo({ paneId: P.id, silencio: 1.8, teto: 180 });
    if (r && r.ok) { avisoTemp(P, 'Pode falar. Ele escreve enquanto você fala e para sozinho quando você parar.'); return; }
    VIVO.P = null;   // sem o programinha (Windows, Mac antigo): segue no modo antigo
  }
  ditadoWhisper(P);
}
const DITADO = { rec: null, pedacos: [], P: null };
async function ditadoWhisper(P) {
  if (DITADO.rec && DITADO.P === P) { pararDitado(); return; }
  if (DITADO.rec) pararDitado();
  let fluxo;
  try {
    // supressao de ruido agressiva come voz baixa e a transcricao volta vazia; ja o ganho
    // automatico ajuda quem fala longe do microfone
    fluxo = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true } });
  } catch (e) {
    avisoEnvio(P, 'Não consegui usar o microfone. Libere em Ajustes do Sistema › Privacidade › Microfone.');
    return;
  }
  DITADO.pedacos = []; DITADO.P = P;
  /* Daqui pra frente o microfone JA ESTA ABERTO. Se o gravador nao nascer, a trilha tem de
     fechar aqui: senao a captura fica ligada sem botao aceso e sem jeito de desligar a nao
     ser fechando o app — e a luzinha do microfone fica acesa no Mac. */
  try { DITADO.rec = new MediaRecorder(fluxo); }
  catch (e) {
    try { fluxo.getTracks().forEach(t => t.stop()); } catch {}
    DITADO.rec = null; DITADO.pedacos = []; DITADO.P = null;
    avisoEnvio(P, 'Não consegui gravar o áudio: ' + ((e && e.message) || 'erro'));
    return;
  }
  DITADO.rec.ondataavailable = (e) => { if (e.data && e.data.size) DITADO.pedacos.push(e.data); };
  DITADO.rec.onstop = async () => {
    fluxo.getTracks().forEach(t => t.stop());
    const bt = $('.p-mic', P.el);
    if (bt) { bt.classList.remove('gravando'); bt.classList.add('pensando'); }
    const blob = new Blob(DITADO.pedacos, { type: 'audio/webm' });
    DITADO.rec = null; DITADO.pedacos = []; DITADO.P = null;
    if (blob.size < 2000) { if (bt) bt.classList.remove('pensando'); return; }
    const b64 = await new Promise(ok => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1] || '');
      fr.readAsDataURL(blob);
    });
    /* Sem este try o botao ficava preso em "pensando" para sempre quando a resposta nao vinha
       (Wi-Fi caiu no meio do envio do audio), e so recarregar a pagina soltava. */
    let r = null;
    try { r = await window.api.ditar({ audio: b64 }); }
    catch (e) { r = { error: String((e && e.message) || e) }; }
    if (bt) bt.classList.remove('pensando');
    if (!r || r.error) { avisoEnvio(P, 'Não entendi o áudio: ' + ((r && r.error) || 'erro')); return; }
    const inp = $('.p-input', P.el);
    inp.value = (inp.value ? inp.value.replace(/\s*$/, ' ') : '') + (r.texto || '').trim();
    inp.dispatchEvent(new Event('input'));
    inp.focus();
  };
  try { DITADO.rec.start(); }
  catch (e) {
    try { fluxo.getTracks().forEach(t => t.stop()); } catch {}
    DITADO.rec = null; DITADO.pedacos = []; DITADO.P = null;
    avisoEnvio(P, 'Não consegui começar a gravar: ' + ((e && e.message) || 'erro'));
    return;
  }
  const bt = $('.p-mic', P.el);
  if (bt) bt.classList.add('gravando');
  avisoEnvio(P, 'Gravando', 'Clique no microfone de novo (ou ⌘⇧D) quando terminar de falar.');
}
function pararDitado() {
  if (DITADO.rec && DITADO.rec.state !== 'inactive') DITADO.rec.stop();
}

/* ============ nível do microfone ============
   O botão do microfone acende, mas nada na tela dizia se o Mac estava OUVINDO de verdade —
   e era esse o susto de "o microfone não funciona". Agora uma barrinha dentro do botão enche
   conforme a voz. O número vem do programinha Swift, do laço de 150ms (nunca da thread de
   áudio, que travaria a captura). As duas faixas abaixo são ancoradas no MESMO limiar que o
   Swift usa para chamar uma coisa de fala. */
const VOZ_LIMIAR = 0.010;   // igual ao `rms > 0.010` do ditado-vivo.swift: daqui pra cima é fala
const VOZ_MUDO = 0.002;     // abaixo disto é linha morta: não chegou som nenhum

// a barrinha nasce na hora em que o primeiro nível chega (o botão é montado sem ela)
function vozBarra(bt) {
  let n = $('.mic-nivel', bt);
  if (!n) { n = document.createElement('span'); n.className = 'mic-nivel'; bt.appendChild(n); }
  return n;
}
function vozNivel(P, ev) {
  const rms = Number(ev.rms) || 0;
  VIVO.nivel = rms;
  // o pico da sessão inteira é quem sabe dizer, no fim, POR QUE não saiu texto
  VIVO.picoGeral = Math.max(VIVO.picoGeral || 0, rms, Number(ev.pico) || 0);
  const bt = $('.p-mic', P.el);
  if (!bt) return;
  vozBarra(bt);
  // `com-nivel` só no caminho AO VIVO: no ditado de reserva (whisper) não chega nível nenhum,
  // e a barra ficaria eternamente vazia dentro de um botão aceso
  bt.classList.add('com-nivel');
  bt.style.setProperty('--nivel', Math.min(1, rms / (VOZ_LIMIAR * 2.5)).toFixed(2));
}
function vozTirarNivel(P) {
  const bt = P && P.el && $('.p-mic', P.el);
  if (!bt) return;
  bt.classList.remove('com-nivel');
  bt.style.removeProperty('--nivel');
}
/* Por que não saiu texto. "Não entendi" não ajuda quem está com o microfone mudo ou baixo
   demais — e é justamente esse o caso que mais acontece.
   O nível sozinho NÃO distingue "o microfone está morto" de "ele não falou": os dois dão
   quase zero. Então o recado do silêncio total é escrito como pergunta, não como acusação. */
function vozDiagnostico(jaAvisou) {
  const p = VIVO.picoGeral || 0;
  // se a nota "Não ouvi nada" já apareceu, não repetir a acusação: só a parte que ajuda
  if (p < VOZ_MUDO) return (jaAvisou ? '' : 'Não chegou som nenhum. ')
    + 'Se você falou, confira em Ajustes do Sistema › Som › Entrada qual microfone está escolhido.';
  // captou, mas nunca no volume que o motor chama de fala: este ele CONSEGUE consertar
  if (p < VOZ_LIMIAR) return 'O microfone captou, mas muito baixo. Aumente o volume de entrada em Ajustes do Sistema › Som, ou fale mais perto.';
  return jaAvisou ? '' : 'Não entendi o que foi falado. Tente falar um pouco mais devagar.';
}

/* ============ soltar o microfone ============
   Qualquer coisa que tire o chat da frente — fechar o chat, fechar a aba, trocar de aba,
   trocar de motor, enviar a mensagem — tem de APAGAR a luz do microfone. Sem isto a captura
   seguia ligada sem botão aceso e sem jeito de desligar a não ser fechando o app.
   `guardarTexto`: o que ele ditou já está escrito no campo e vai junto com o envio; aí é só
   tirar a camada de cima, sem reescrever nada e sem roubar o foco. */
const vozTextoAgora = () => ((VIVO.base ? VIVO.base.replace(/\s*$/, ' ') : '') + VIVO.firme
  + (VIVO.parcial ? ' ' + VIVO.parcial : '')).trim();
// só o que já FECHOU: a palavra do comando ainda está em VIVO.parcial e não pode ir junto
const vozTextoFirme = () => ((VIVO.base ? VIVO.base.replace(/\s*$/, ' ') : '') + VIVO.firme).trim();
function vozZerar() {
  VIVO.P = null; VIVO.base = ''; VIVO.firme = ''; VIVO.parcial = '';
  VIVO.ultimo = ''; VIVO.ultimoEscrito = null;
  VIVO.nivel = 0; VIVO.picoGeral = 0; VIVO.jaAvisou = false;
}
function vozSoltar(P, opts) {
  const o = opts || {};
  if (VIVO.P && (!P || VIVO.P === P)) {
    const Q = VIVO.P;
    const texto = o.texto != null ? o.texto : vozTextoAgora();
    /* Zerar o VIVO ANTES de mandar parar: o processo morre e o 'fim' chega logo atrás. Com o
       VIVO já limpo, o `if (VIVO.P !== P) return;` do vozEvento joga esse 'fim' fora — senão
       ele reescreveria no campo a mensagem que acabou de ser enviada. */
    vozZerar();
    try { window.api.vozParar({ paneId: Q.id, cancelar: true }); } catch (_) {}
    vozTirarNivel(Q);
    vozEncerrarTela(Q, o.guardarTexto ? null : texto);
  }
  if (DITADO.P && (!P || DITADO.P === P)) { try { pararDitado(); } catch (_) {} }
}

/* ============ comandos falados ============
   A frase que acabou de fechar, quando é SÓ um comando, não vira texto: vira ação. Sem modelo
   extra — a frase normalizada contra meia dúzia de padrões. Roda ANTES de o texto entrar no
   campo, então a palavra "manda" nunca aparece escrita. */
function normalizarFala(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function vozComando(P, texto) {
  const t = normalizarFala(texto);
  if (!t || t.split(' ').length > 4) return false;

  if (/^(manda|mandar|envia|enviar)( isso| agora| ai)?$/.test(t)) {
    vozSoltar(P, { texto: vozTextoFirme() });
    const inp = $('.p-input', P.el);
    if (!inp || !(inp.value.trim() || (P.anexos || []).length || P.quadroColado)) return true;
    // um respiro: o campo acabou de receber o texto firmado e o 'fim' do processo ainda vem
    setTimeout(() => { if (panes.get(P.id) === P) send(P); }, 60);
    return true;
  }
  if (/^(cancela|cancelar)( isso| tudo| o ditado)?$/.test(t)) {
    vozSoltar(P, { texto: (VIVO.base || '').replace(/\s*$/, '') });
    return true;
  }
  if (/^(apaga|apagar|remove|remover) (isso|essa|essa frase|a ultima|a ultima frase|o ultimo)$/.test(t)) {
    // some só a última frase FECHADA; o ditado continua ligado e ele segue falando
    if (VIVO.ultimo) {
      const i = VIVO.firme.lastIndexOf(VIVO.ultimo);
      if (i >= 0) VIVO.firme = VIVO.firme.slice(0, i).replace(/\s*$/, '');
      VIVO.ultimo = '';
    }
    VIVO.parcial = '';
    vozPintar(P);
    return true;
  }
  if (/^proximo painel$/.test(t)) {
    vozSoltar(P, { texto: vozTextoFirme() });
    // não existe `irParaPainel` aqui: quem manda no foco é a aba (abaDe) mais o setFocus
    const A = abaDe(P);
    if (A && A.ordem.length > 1) {
      const i = A.ordem.indexOf(P.id);
      const alvo = panes.get(A.ordem[(i + 1) % A.ordem.length]);
      if (alvo) { setFocus(alvo); const c = $('.p-input', alvo.el); if (c) c.focus(); }
    }
    return true;
  }
  return false;
}

/* ---- avisar quando a resposta fica pronta ----
   So avisa se ele NAO estiver na janela e se a espera tiver valido a pena (menos de 8s ele
   ainda esta olhando a tela; recado nessa hora e barulho). */
const ESPERA_PRA_AVISAR = 8000;
function avisarQueTerminou(P) {
  if (!P.busy || !P.comecouEm) return;
  const demorou = Date.now() - P.comecouEm;
  P.comecouEm = 0;
  if (demorou < ESPERA_PRA_AVISAR || document.hasFocus()) return;
  const b = P.blocks.get('resp');
  const resposta = (b && b.raw ? b.raw : '').replace(/[#*`>_-]/g, ' ').replace(/\s+/g, ' ').trim();
  const onde = (P.titulo || nomePasta(P.cwd) || 'Cockpit').slice(0, 50);
  window.api.avisarPronto({
    paneId: P.id,
    titulo: nomeDoMotor(P.engine) + ' terminou · ' + onde,
    texto: resposta || 'A resposta está pronta.',
  });
}

/* ---- copiar com um clique: a resposta inteira e cada bloco de codigo ----
   Antes nao havia botao nenhum: a unica saida era arrastar o mouse pelo texto. */
/* Copia da era antiga: uma caixa de texto escondida, marcada e copiada. E o unico jeito que
   funciona no iPhone, porque o Safari so libera o clipboard moderno em endereco seguro (https)
   e o Cockpit no celular e servido em http. Tem de rodar JUNTO com o toque, sem esperar nada
   antes, senao o Safari entende que nao foi o dedo dele e recusa. */
function copiarNaMarra(txt) {
  try {
    const cx = document.createElement('textarea');
    cx.value = String(txt == null ? '' : txt);
    cx.setAttribute('readonly', '');
    // font-size 16: abaixo disso o iPhone da zoom na tela ao focar um campo
    cx.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
    document.body.appendChild(cx);
    cx.select();
    cx.setSelectionRange(0, cx.value.length);   // no iPhone o select() sozinho nao marca nada
    const deu = document.execCommand('copy');
    cx.remove();
    return !!deu;
  } catch (_) { return false; }
}

async function copiarTexto(txt, botao) {
  const texto = String(txt == null ? '' : txt);
  /* No telefone o jeito antigo vem PRIMEIRO, colado no toque. Antes o botao tentava o atalho
     do Mac (que la nao existe) e depois o clipboard do navegador (que o Safari barra em http):
     as duas falhavam e o codigo desistia calado — tocar no icone nao fazia absolutamente nada. */
  let deu = window.SEM_ELECTRON ? copiarNaMarra(texto) : false;
  if (!deu) {
    // no Mac quem copia e o processo principal: dentro do app o clipboard do navegador as vezes
    // e barrado, e um botao de copiar que as vezes nao copia e pior do que nao ter botao
    try { await window.api.copiar(texto); deu = true; }
    catch {
      try { await navigator.clipboard.writeText(texto); deu = true; }
      catch { deu = copiarNaMarra(texto); }
    }
  }
  if (!deu) {
    // some da memoria antes de mostrar: um X dado um dia nao pode calar o aviso para sempre
    avisosFechados.delete('copiar-nao-deu');
    mostrarAviso({ id: 'copiar-nao-deu', tipo: 'erro',
      texto: 'Não consegui copiar. Segure o dedo no texto e use o Copiar do aparelho.' });
    return false;
  }
  if (!botao) return true;
  const antes = botao.innerHTML;
  botao.innerHTML = ico('check');
  botao.classList.add('copiou');
  setTimeout(() => { botao.innerHTML = antes; botao.classList.remove('copiou'); }, 1400);
  return true;
}
function botaoCopiar(titulo, pegarTexto) {
  const b = document.createElement('button');
  b.className = 'bt-copiar'; b.title = titulo; b.innerHTML = ico('copy');
  b.addEventListener('click', (e) => { e.stopPropagation(); copiarTexto(pegarTexto(), b); });
  return b;
}
/* a barrinha de ações mora na linha do rótulo (redesenho 26/09): na minha mensagem, à esquerda
   do "Você"; na resposta, logo depois do nome da IA. No pé da resposta ela encavalava no
   "Levou 3m 40s" do fim do turno. Fala sem rótulo quase nunca tem barra (o copiar da primeira
   fala leva a resposta toda); se tiver, ela entra antes do texto e o CSS a põe no vão de 22
   logo acima dele, nunca embaixo. */
function barraDeAcoes(msg) {
  let barra = $('.msg-acoes', msg);
  if (!barra) {
    barra = document.createElement('div');
    barra.className = 'msg-acoes';
    const rotulo = $('.msg-role', msg);
    if (rotulo) rotulo.appendChild(barra); else msg.insertBefore(barra, msg.firstChild);
  }
  return barra;
}

/* Bloco de código que veio sem a linguagem na cerca (```): a barra de 28 ficava vazia, só com o
   copiar. O nome é só um rótulo, então basta um palpite barato pelo começo do texto; na dúvida,
   "texto" (saída de comando, árvore de pastas, rascunho). */
function linguagemProvavel(txt) {
  const t = String(txt || '').trim();
  const l1 = t.split('\n', 1)[0];
  if (/^(\$ |sudo |npm |npx |node |git |cd |ls |curl |python3? |pip3? |brew |rclone |cat |mkdir |rm |cp |mv |open |echo |export |yarn |pnpm |docker |ssh |scp |chmod |grep |find |sed |awk |tar |unzip |wget |source |bash |zsh |sh |launchctl |defaults |osascript |kill |ps |lsof )/.test(l1)) return 'bash';
  if (/^[[{]/.test(t)) { try { JSON.parse(t); return 'json'; } catch {} }
  if (/^<[!a-zA-Z]/.test(t) && />\s*$/.test(t)) return 'html';
  return 'texto';
}
/* A resposta pode vir em várias falas (texto, passos, mais texto): o rótulo e o copiar ficam só
   na primeira, e o copiar dela leva a RESPOSTA INTEIRA (ela e as falas sem rótulo que vêm depois,
   até a próxima mensagem minha ou a próxima resposta). Lido na hora do clique: pega também o
   que chegou depois. */
function textoDaResposta(msg) {
  const partes = [msg._texto ? msg._texto() : ''];
  for (let e = msg.nextElementSibling; e; e = e.nextElementSibling) {
    if (!e.classList.contains('msg')) continue;              // passos, trabalhando, avisos
    if (!e.classList.contains('emenda')) break;              // mensagem minha ou outra resposta
    if (e._texto) partes.push(e._texto());
  }
  return partes.filter(t => t && t.trim()).join('\n\n');
}
// a fala sem rótulo tem a primeira fala da resposta (a do rótulo) acima dela, na tela?
function temRotuloAcima(msg) {
  for (let e = msg.previousElementSibling; e; e = e.previousElementSibling) {
    if (!e.classList.contains('msg')) continue;
    if (!e.classList.contains('bot')) return false;
    if (!e.classList.contains('emenda')) return true;
  }
  return false;
}
function botoesDeCopia(b) {
  const msg = b.el.closest('.msg');
  if (msg) msg._texto = () => b.raw || b.el.innerText;
  // fala sem rótulo não ganha copiar próprio: o da primeira fala já copia a resposta toda
  const continuacao = msg && msg.classList && msg.classList.contains('emenda') && temRotuloAcima(msg);
  if (msg && !continuacao && !$('.bt-copiar.da-msg', msg)) {
    const bt = botaoCopiar('Copiar a resposta', () => textoDaResposta(msg));
    bt.classList.add('da-msg');
    barraDeAcoes(msg).appendChild(bt);
  }
  // cada innerHTML novo joga fora os botoes de codigo antigos: refazer sempre
  for (const pre of b.el.querySelectorAll('pre')) {
    if ($('.bt-copiar', pre)) continue;
    pre.classList.add('com-copia');
    /* a barra de 28 do bloco de código mostra a linguagem (o CSS lê o data-lang). O marked
       põe a linguagem na classe do <code> ("language-js"); sem ela, vale o palpite do linguagemProvavel */
    const cod = pre.querySelector('code');
    const lang = cod && /(?:^|\s)language-([\w+#.-]+)/.exec(cod.className);
    pre.dataset.lang = lang ? lang[1] : linguagemProvavel((cod || pre).textContent);
    pre.appendChild(botaoCopiar('Copiar o código', () => (pre.querySelector('code') || pre).innerText));
  }
}

/* ===================== RECIBO DO TURNO (so o visual) =====================
   Quando a resposta termina com um titulo so "Recibo" (ou "Recibo do turno"), esse fecho
   vira um cartao destacado no fim da fala em vez de mais um titulo perdido no texto.
   Fica inerte enquanto ninguem pedir esse fecho ao agente: sem o titulo, nao faz nada. */
function marcarRecibo(el) {
  if (!el || el.querySelector('.recibo')) return;
  const cabs = [...el.querySelectorAll('h1,h2,h3,h4')];
  // titulo SO "Recibo" (ou "Recibo do turno"): "Recibo de pagamento" e assunto, nao fecho
  const cab = cabs.find((h) => /^\s*recibo(\s+do\s+turno)?\s*:?\s*$/i.test(h.textContent || ''));
  if (!cab || cab.parentNode !== el) return;   // so no nivel de cima da fala
  const nivel = (h) => Number(h.tagName[1]) || 9;
  // tem outra secao do mesmo nivel (ou acima) depois dele: nao e o fecho, nao engole o resto
  if (cabs.slice(cabs.indexOf(cab) + 1).some((h) => nivel(h) <= nivel(cab))) return;
  const cx = document.createElement('div');
  cx.className = 'recibo';
  el.insertBefore(cx, cab);
  let n = cab;
  while (n) { const prox = n.nextSibling; cx.appendChild(n); n = prox; }
  cab.classList.add('recibo-tit');
}

function marcarLinksWeb(el) {
  for (const a of el.querySelectorAll('a[href^="http"]')) {
    a.classList.add('link-web');
    a.title = 'abre no seu navegador';
  }
}

/* Miniatura da entrega. Guardada por caminho porque a mesma fala e redesenhada varias vezes
   (o ACP manda a fala inteira de novo a cada 100ms): sem a gaveta, cada redesenho pediria a
   imagem inteira ao Mac outra vez. Poucas vagas: e vitrine, nao arquivo. */
const miniaturas = new Map();
const EXT_MINIATURA = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
function miniaturaDaEntrega(P, a, caminho) {
  const cx = document.createElement('span');
  cx.className = 'entrega-img';
  cx.title = 'abre aqui dentro';
  cx.onclick = (e) => { e.preventDefault(); e.stopPropagation(); verArquivo(P, caminho); };
  /* A miniatura é um bloco (220×132 + o nome embaixo): colada logo depois do link ela partia
     o parágrafo ao meio e o "." do fim da frase caía embaixo da imagem. Agora ela entra DEPOIS
     do parágrafo do link (e depois das outras miniaturas que já estão ali, na mesma ordem dos
     links). Link fora de parágrafo (item de lista, tabela) continua do jeito antigo. */
  const par = a.closest('p');
  if (par && par.parentNode) {
    let ult = par;
    while (ult.nextElementSibling && ult.nextElementSibling.classList.contains('entrega-img')) ult = ult.nextElementSibling;
    ult.after(cx);
  } else a.after(cx);
  if (!miniaturas.has(caminho)) {
    if (miniaturas.size >= 24) miniaturas.delete(miniaturas.keys().next().value);
    // new Promise pega ate erro na hora da chamada: miniatura que falha nao pode derrubar a fala
    miniaturas.set(caminho, new Promise((ok) => ok(lerParaVisor(caminho))).catch(() => null));
  }
  miniaturas.get(caminho).then((r) => {
    if (!r || r.tipo !== 'imagem' || !r.dados) { miniaturas.delete(caminho); cx.remove(); return; }
    const img = document.createElement('img');
    img.alt = a.textContent || ''; img.src = r.dados;
    // quadro de raio 10 (o contorno de 1pt fica por cima da imagem) + o nome do arquivo em mono
    const quadro = document.createElement('span'); quadro.className = 'ei-quadro';
    const nome = document.createElement('span'); nome.className = 'ei-nome';
    nome.textContent = caminho.split('/').pop();
    quadro.appendChild(img);
    cx.append(quadro, nome);
  });
}

function linkarArquivos(P, el) {
  /* Link de arquivo que veio do markdown ("[Baixar arte](/Users/.../arte.png)"): o caminho ja
     vem marcado pelo markdownSeguro. Imagem ganha miniatura logo abaixo, para a entrega
     aparecer na conversa sem precisar clicar. Teto de 6 por fala para lista grande nao
     virar galeria. */
  let vitrine = 0;
  for (const a of el.querySelectorAll('a.arquivo[data-caminho]')) {
    const caminho = caminhoDoPainel(P, a.dataset.caminho);
    a.title = caminho;
    a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); verArquivo(P, caminho); };
    if (EXT_MINIATURA.test(caminho) && vitrine < 6) { vitrine++; miniaturaDaEntrega(P, a, caminho); }
  }
  /* Painel da VPS fala de caminho de LINUX (/home, /opt, /var…), que aqui no Mac nem existe.
     Por isso a peneira muda com o painel: raizes do Mac num painel local, raizes do Linux num
     painel da VPS. Sem isso, ou o link nem aparecia, ou apontava para o arquivo errado. */
  /* R3-032: pasta com espaço no nome (ex.: "Copy Lançamentos") nunca fechava o ".ext" sem
     espaço no meio, entao o caminho inteiro ficava cru, sem virar link. Corpo aceita espaço
     ENTRE palavras (olhando que o char seguinte nao e espaço/aspas/fecha-parenteses), mas o
     `?` deixa a busca PREGUIÇOSA: para no PRIMEIRO ".ext" que achar, nao no ULTIMO da frase
     (testado: greedy sem o `?` atravessava frase inteira até um número tipo "2.5" mais adiante). */
  const re = NA_VPS(P.cwd)
    ? /(\/(?:home|root|opt|srv|var|etc|usr|mnt|media|data|tmp)\/(?:[^\s"'<>)]|\s(?=[^\s"'<>)])){1,200}?\.[A-Za-z0-9]{1,6})(?![A-Za-z0-9])/g
    : /(\/(?:Users|tmp|private|Volumes)\/(?:[^\s"'<>)]|\s(?=[^\s"'<>)])){1,200}?\.[A-Za-z0-9]{1,6})(?![A-Za-z0-9])/g;
  const andar = (no) => {
    for (const filho of [...no.childNodes]) {
      if (filho.nodeType === 3) {
        const txt = filho.textContent;
        if (!re.test(txt)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let ult = 0, m;
        while ((m = re.exec(txt))) {
          if (m.index > ult) frag.appendChild(document.createTextNode(txt.slice(ult, m.index)));
          const caminho = m[1];                       // guarda o valor: o m muda no proximo laço
          const a = document.createElement('a');
          a.className = 'arquivo'; a.textContent = caminho; a.href = '#';
          a.title = 'abre aqui dentro';
          a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); verArquivo(P, caminhoDoPainel(P, caminho)); };
          frag.appendChild(a);
          ult = m.index + caminho.length;
        }
        if (ult < txt.length) frag.appendChild(document.createTextNode(txt.slice(ult)));
        filho.replaceWith(frag);
      } else if (filho.nodeType === 1 && !['A', 'PRE', 'CODE'].includes(filho.tagName)) andar(filho);
    }
  };
  andar(el);
}

function textFinal(P, key, text) {
  if (!text || !text.trim()) return;
  let b = P.blocks.get('resp');
  const depoisDeComando = P.execEl && P.execEl.isConnected;
  // R3-030: texto que nasce um bloco visual NOVO (id/key trocou, ou veio depois de uma
  // ferramenta) tem de virar entrada NOVA em P.hist; so redesenho do MESMO bloco pode
  // sobrescrever a ultima. Sem isso, texto+ferramenta+texto no mesmo turno perdia o 1o
  // texto do historico (a 2a chamada sobrescrevia em cima, mesmo os dois ficando na tela).
  const blocoNovo = !b || P.blocks.get('respKey') !== key || depoisDeComando;
  if (blocoNovo) {
    if (b && !depoisDeComando) { b.raw = ''; b.el.innerHTML = ''; b.corte = 0; b.fixos = 0; }
    else { b = botBlock(P, 'resp'); }
    P.blocks.set('respKey', key); P.blocks.set('resp', b);
    P.execEl = null;
  }
  // aqui o bloco e refeito INTEIRO, de uma vez so: e o desenho que vale no fim do turno
  b.raw = text; b.el.innerHTML = marked.parse(text); b.corte = 0; b.fixos = 0;
  b.el.classList.remove('chegando');   // a fala está inteira: sem o cursor de "ainda escrevendo"
  legendarTrabalho(P, text);
  linkarArquivos(P, b.el); marcarLinksWeb(b.el); botoesDeCopia(b); marcarRecibo(b.el);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
  const quem = nomeDoMotor(P.engine);
  const ult = P.hist[P.hist.length - 1];
  if (!blocoNovo && ult && ult.quem === quem) ult.texto = text; else P.hist.push({ quem, texto: text });
}
/* ============ antes e depois de cada edição ============
   O motor mexe no arquivo e a tela mostrava só o nome dele. Aqui a mudança aparece pintada:
   vermelho o que saiu, verde o que entrou — e um botão que desfaz aquele pedaço. */

/* diff por linhas. LCS puro estoura em arquivo grande (matriz N×M), então acima do teto
   a tela mostra os dois blocos inteiros em vez de casar linha a linha. */
const DIFF_TETO = 500;
function linhasDoDiff(antes, depois) {
  const a = String(antes || '').split('\n');
  const b = String(depois || '').split('\n');
  if (a.length > DIFF_TETO || b.length > DIFF_TETO) {
    return [...a.filter((_, i) => i < DIFF_TETO).map(t => ({ t: '-', txt: t })),
            ...b.filter((_, i) => i < DIFF_TETO).map(t => ({ t: '+', txt: t }))];
  }
  // tabela do maior pedaço em comum
  const m = a.length, n = b.length;
  const tab = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      tab[i][j] = a[i] === b[j] ? tab[i + 1][j + 1] + 1 : Math.max(tab[i + 1][j], tab[i][j + 1]);
    }
  }
  const saida = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { saida.push({ t: ' ', txt: a[i] }); i++; j++; }
    else if (tab[i + 1][j] >= tab[i][j + 1]) { saida.push({ t: '-', txt: a[i] }); i++; }
    else { saida.push({ t: '+', txt: b[j] }); j++; }
  }
  while (i < m) saida.push({ t: '-', txt: a[i++] });
  while (j < n) saida.push({ t: '+', txt: b[j++] });
  return saida;
}

/* patch unificado (o Codex às vezes já manda pronto) vira as mesmas linhas coloridas */
function linhasDoPatch(patch) {
  return String(patch || '').split('\n')
    .filter(l => !/^(diff |index |--- |\+\+\+ )/.test(l))
    .map(l => l.startsWith('+') ? { t: '+', txt: l.slice(1) }
            : l.startsWith('-') ? { t: '-', txt: l.slice(1) }
            : l.startsWith('@@') ? { t: '@', txt: l }
            : { t: ' ', txt: l.replace(/^ /, '') });
}

/* esconde o miolo que ninguém precisa ver: 3 linhas de contexto em volta de cada mudança */
const CONTEXTO = 3;
function comContexto(linhas) {
  const perto = new Set();
  linhas.forEach((l, i) => {
    if (l.t === ' ') return;
    for (let k = i - CONTEXTO; k <= i + CONTEXTO; k++) if (k >= 0 && k < linhas.length) perto.add(k);
  });
  const saida = [];
  let pulando = 0;
  linhas.forEach((l, i) => {
    if (perto.has(i)) {
      if (pulando) { saida.push({ t: '@', txt: '⋯ ' + pulando + ' linha' + (pulando > 1 ? 's' : '') + ' sem mudança' }); pulando = 0; }
      saida.push(l);
    } else pulando++;
  });
  if (pulando) saida.push({ t: '@', txt: '⋯ ' + pulando + ' linha' + (pulando > 1 ? 's' : '') + ' sem mudança' });
  return saida;
}

/* O patch (Codex) diz em que linha do arquivo cada pedaco esta ("@@ -211,4 +211,4 @@"): da
   para numerar as linhas como o diff do design. O antes/depois do Claude nao diz — ali a coluna
   do numero fica de fora, em vez de inventar um numero que nao e o do arquivo. */
function numerarPatch(cru) {
  let velho = 0, novo = 0, achou = false;
  for (const l of cru) {
    if (l.t === '@') {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l.txt);
      if (m) { velho = +m[1]; novo = +m[2]; achou = true; }
      continue;
    }
    if (!achou) continue;
    if (l.t === '-') l.n = velho++;
    else if (l.t === '+') l.n = novo++;
    else { l.n = novo++; velho++; }
  }
  return achou;
}
/* A mesma conta do numerarPatch quando só se sabe a linha onde o trecho começa (o pedido de
   autorização: o main.js acha o trecho no arquivo). O antes e o depois começam nela. */
function numerarDesde(cru, linha) {
  let velho = linha, novo = linha;
  for (const l of cru) {
    if (l.t === '-') l.n = velho++;
    else if (l.t === '+') l.n = novo++;
    else if (l.t !== '@') { l.n = novo++; velho++; }
  }
}
function cartaoDeDiff(P, ed) {
  const cx = document.createElement('div');
  cx.className = 'dif';
  const nome = (ed.arquivo || '').split('/').pop();
  const partes = ed.patch ? [{ patch: ed.patch }] : (ed.partes || []);
  let mais = 0, menos = 0, comNumero = false;
  const corpos = [];

  for (const p of partes) {
    const cru = p.patch ? linhasDoPatch(p.patch) : linhasDoDiff(p.antes, p.depois);
    if (p.patch && numerarPatch(cru)) comNumero = true;
    for (const l of cru) { if (l.t === '+') mais++; else if (l.t === '-') menos++; }
    const bloco = document.createElement('div');
    bloco.className = 'dif-bloco';
    const numerado = p.patch && cru.some(l => l.n != null);
    let hunks = 0;
    for (const l of comContexto(cru)) {
      const linha = document.createElement('div');
      linha.className = 'dl ' + (l.t === '+' ? 'mais' : l.t === '-' ? 'menos' : l.t === '@' ? 'pula' : 'igual');
      // com as linhas numeradas, o "@@ -211,4 +211,4 @@" so repete o que o numero ja diz: o
      // primeiro some e os outros viram so a marca de pulo entre um pedaco e outro
      if (numerado && l.t === '@' && /^@@ /.test(l.txt)) { if (!hunks++) continue; linha.textContent = '⋯'; }
      else if (l.t === '@') linha.textContent = l.txt;
      else {
        // numero (34, label-3) + sinal (14) + texto: cada um no seu span para alinhar em coluna
        linha.innerHTML = '<span class="dl-n"></span><span class="dl-s"></span><span class="dl-x"></span>';
        linha.firstChild.textContent = l.n != null ? String(l.n) : '';
        linha.children[1].textContent = l.t === '+' ? '+' : l.t === '-' ? '−' : '';
        linha.lastChild.textContent = l.txt;
      }
      bloco.appendChild(linha);
    }
    if (!p.patch && ed.arquivo) {
      const bt = document.createElement('button');
      bt.className = 'dif-desfaz';
      bt.textContent = 'Desfazer esta mudança';
      bt.onclick = async () => {
        bt.disabled = true; bt.textContent = 'desfazendo…';
        const r = await window.api.desfazerEdicao({ arquivo: ed.arquivo, antes: p.antes, depois: p.depois });
        if (r && r.ok) { bt.textContent = 'desfeito'; bt.classList.add('feito'); bloco.classList.add('desfeito'); }
        else { bt.disabled = false; bt.textContent = 'não deu: ' + ((r && r.error) || 'erro'); bt.classList.add('falhou'); }
      };
      bloco.appendChild(bt);
    }
    corpos.push(bloco);
  }

  if (!comNumero) cx.classList.add('sem-num');
  const cab = document.createElement('div');
  cab.className = 'dif-hd';
  cab.innerHTML = '<span class="dif-nm"></span><span class="dif-cnt"></span>'
    + '<button class="dif-abrir" title="Abrir o arquivo">' + ico('external') + '</button>';
  // a pasta de cima + o nome ("oficina/index.html"), como no design: so o nome nao diz qual
  // dos tres index.html do projeto foi mexido. O caminho inteiro fica no title.
  const trecho = String(ed.arquivo || '').split('/').filter(Boolean).slice(-2).join('/') || nome;
  $('.dif-nm', cab).textContent = (ed.novo ? 'criou ' : '') + trecho;
  $('.dif-nm', cab).title = ed.arquivo || '';
  $('.dif-cnt', cab).innerHTML = '<b class="v">+' + mais + '</b> <b class="r">−' + menos + '</b>';
  $('.dif-abrir', cab).onclick = (e) => { e.stopPropagation(); verArquivo(P, caminhoDoPainel(P, ed.arquivo)); };
  cab.addEventListener('click', () => cx.classList.toggle('fechado'));
  cx.appendChild(cab);
  for (const c of corpos) cx.appendChild(c);
  // Quem nasce fechado é o PASSO que segura este cartão (ver toolStart). Fechar o cartão aqui
  // também obrigaria a dois cliques para ver a mesma coisa. Aberto, um clique basta — e o
  // cabeçalho continua servindo de interruptor para quem quiser recolher só o diff.
  return cx;
}

/* ---- lista de tarefas: era só a frase "Organizando as tarefas" ---- */
function cartaoDeTarefas(tarefas) {
  const cx = document.createElement('div');
  cx.className = 'tar';
  for (const t of tarefas) {
    const st = String(t.status || '');
    const l = document.createElement('div');
    l.className = 'tar-l ' + (st === 'completed' ? 'ok' : st === 'in_progress' ? 'agora' : 'espera');
    l.innerHTML = '<span class="tar-ic"></span><span class="tar-t"></span>';
    $('.tar-ic', l).innerHTML = st === 'completed' ? ico('check') : st === 'in_progress' ? ico('circle') : '';
    $('.tar-t', l).textContent = (st === 'in_progress' && t.activeForm) ? t.activeForm : (t.content || '');
    cx.appendChild(l);
  }
  return cx;
}

function toolStart(P, id, name, arg, extra) {
  const d = passo(P, fraseDoPasso(name, arg), id);
  if (!d) return;
  P.tools.set(id, { el: d, out: $('.exec-out', d), buf: '' });
  const ex = extra || {};
  // Nada nasce aberto. O passo mostra só a frase do que está fazendo; o conteúdo (diff,
  // saída do comando, lista de tarefas) só aparece se ele clicar.
  if (ex.edicao) {
    const alvo = $('.exec-out', d);
    alvo.textContent = '';
    const cartao = cartaoDeDiff(P, ex.edicao);
    alvo.appendChild(cartao);
    d.classList.add('tem-dif');
    // "+1 −1" sobe para a linha do passo, ao lado do nome do arquivo (no cartao fica so o
    // arquivo e o "abrir"). O cartao continua com a contagem para a janela "ver mudanças".
    const cnt = $('.dif-cnt', cartao);
    if (cnt) $('.exec-nm', d).insertAdjacentHTML('afterend', '<span class="exec-cnt">' + cnt.innerHTML + '</span>');
    P.tools.get(id).semTexto = true;            // o resultado cru não sobrescreve o diff
    P.edicoes = P.edicoes || [];
    P.edicoes.push(ex.edicao);                  // guardado para o "voltar no tempo"
    // e tambem no rastro DESTE turno, que o carimbo do fim mostra junto ("ver mudanças").
    // Lista separada de proposito: a P.edicoes e da sessao inteira e nunca e zerada.
    (P.mudancasTurno = P.mudancasTurno || []).push(ex.edicao);
  }
  if (ex.tarefas && ex.tarefas.length) {
    const alvo = $('.exec-out', d);
    alvo.textContent = '';
    alvo.appendChild(cartaoDeTarefas(ex.tarefas));
    P.tools.get(id).semTexto = true;
    d.classList.add('tem-tar');
    // "Organizando tarefas 3 de 4": quantas ja estao feitas, no lugar do objeto
    const feitas = ex.tarefas.filter(t => t && t.status === 'completed').length;
    $('.exec-obj', d).textContent = feitas + ' de ' + ex.tarefas.length;
  }
}
function toolOutput(P, id, text) {
  const t = P.tools.get(id); if (!t || t.semTexto) return;
  t.buf += text;
  if (t.buf.length > 20000) t.buf = t.buf.slice(-20000);
  t.out.textContent = t.buf;
}
function toolEnd(P, id, output, isErr, imagens) {
  passoPronto(P, id, isErr);
  const t = P.tools.get(id); if (!t) return;
  /* ANTES do return antecipado da linha de baixo: um passo com diff (semTexto) tambem pode ter
     trazido print, e ali a funcao ja teria voltado sem pendurar a imagem. */
  if (imagens && imagens.length) mostrarPrintsDoPasso(P, t.el, imagens);
  if (t.semTexto && !isErr) return;      // o diff (ou a lista de tarefas) vale mais que o texto cru
  let txt = (output || t.buf || '').toString().trim();
  if (txt.length > 20000) txt = txt.slice(0, 20000) + '\n… (cortado)';
  t.out.textContent = txt;
  if (t.el.classList.contains('aberto')) scroll(P);
}
function note(P, text, isErr) {
  if (!isErr) return;                 // a tela mostra so pergunta, trabalhando e resposta
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'note err';
  d.textContent = text;
  P.chat.appendChild(d); scroll(P, true);
}

/* ===================== SINAIS DO TURNO =====================
   Um turno de 20 minutos era uma caixa preta: acabava e nao sobrava nada dizendo quanto
   levou, quanto consumiu, o que mexeu em arquivo nem o que ele viu. Aqui nasce o rastro do
   turno (zerado a cada turno novo) e o carimbo discreto que fecha a conversa. */
function comecarTurno(P) {
  /* Relogio PROPRIO do turno. Nao dava pra reaproveitar o P.comecouEm: ele e do aviso de
     "ficou pronto" e o avisarQueTerminou o zera UMA LINHA antes do carimbo ser desenhado. */
  limparSugestoes(P);
  P.t0 = Date.now();
  P.usoTurno = null;
  P.mudancasTurno = [];
  P.diffTurno = '';
  P.printsTurno = [];
}
function duracaoCurta(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm' + String(s % 60).padStart(2, '0') + 's';
}
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n || 0));
// quantos arquivos o diff agregado do Codex mexeu
function arquivosDoDiffUnificado(diff) {
  const m = String(diff || '').match(/^diff --git /gm);
  return m ? m.length : 1;
}
// quantos arquivos DIFERENTES este turno editou (o mesmo arquivo pode ter varias edicoes)
function arquivosDasMudancas(P) {
  return new Set((P.mudancasTurno || []).map((ed) => ed && ed.arquivo).filter(Boolean)).size
    || (P.mudancasTurno || []).length;
}

/* linha discreta no fim do turno: quanto levou, quanto consumiu e o que mudou.
   A guarda do P.t0 nao e' enfeite: o Codex manda 'turn-end' DUAS vezes (turn/completed e
   status idle), e sem ela sairiam dois carimbos por turno. */
function marcarFimDoTurno(P) {
  if (!P.t0) return;
  const levou = Date.now() - P.t0;
  P.t0 = 0;
  const temMudanca = !!(P.diffTurno || (P.mudancasTurno && P.mudancasTurno.length));
  const prints = (P.printsTurno || []).slice();      // congela: o turno seguinte zera a lista
  // resposta curta, sem mudanca e sem print nao precisa de carimbo
  if (levou < 3000 && !temMudanca && !prints.length) return;
  const d = document.createElement('div');
  d.className = 'turno-fim';
  const txt = document.createElement('span');
  txt.className = 'turno-levou';
  const tok = P.tokens ? (P.tokens / 1000).toFixed(1) + 'k de contexto' : '';
  const uso = P.usoTurno ? fmtK(P.usoTurno.entrada) + '↑ ' + fmtK(P.usoTurno.saida) + '↓' : '';
  /* redesenho 25/09: na linha fica só "Levou 3m 40s" (como no design); o consumo do turno e o
     tamanho do contexto continuam a um passar de mouse, no title */
  txt.textContent = 'Levou ' + duracaoCurta(levou).replace(/m(\d\d)s$/, (_, seg) => (seg === '00' ? 'm' : 'm ' + Number(seg) + 's'));
  const detalhe = [uso, tok].filter(Boolean).join(' · ');
  if (detalhe) txt.title = detalhe;
  d.appendChild(txt);
  if (temMudanca) {
    const n = P.diffTurno ? arquivosDoDiffUnificado(P.diffTurno) : arquivosDasMudancas(P);
    const bt = document.createElement('button');
    bt.className = 'turno-mudancas';
    bt.textContent = 'Ver mudanças · ' + n + (n === 1 ? ' arquivo' : ' arquivos');
    bt.title = 'Tudo que este turno mexeu em arquivo, num lugar só';
    // congela o rastro DESTE turno: o proximo turno zera P.mudancasTurno
    const mudancas = (P.mudancasTurno || []).slice();
    const diffTurno = P.diffTurno || '';
    bt.addEventListener('click', (e) => { e.stopPropagation(); mostrarMudancasDoTurno(P, mudancas, diffTurno); });
    d.appendChild(bt);
  }
  if (prints.length) {
    const bp = document.createElement('button');
    bp.className = 'turno-mudancas turno-prints';
    bp.textContent = 'Ver ' + (prints.length === 1 ? 'print' : 'prints') + ' · ' + prints.length;
    bp.title = 'As imagens que o agente viu neste turno';
    bp.addEventListener('click', (e) => { e.stopPropagation(); mostrarPrintsDoTurno(P, prints); });
    d.appendChild(bp);
  }
  P.chat.appendChild(d);
  scroll(P);
}

/* R9: o .modal-cx nao volta ao normal sozinho. Quem carimba classe (aqui, cx-term de 780px)
   tem de desfazer na saida, senao a proxima janelinha DESTE painel nasce deformada. O unico
   gancho que o Esc respeita e o P.fecharTerminal — e por ele que a limpeza acontece. */
function abrirJanelaLarga(P, titulo) {
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  /* O .p-modal guarda a marca da ultima superficie que abriu ali (menu, conectores, conta) e
     ninguem limpa na saida. Sem estas duas linhas, um painel que ja mostrou a Conta do Codex
     fica marcado 'account' para sempre: ao chegar o evento rotineiro de conta, o laco que
     repinta a conta trocaria o conteudo DESTA janela por baixo do dono. */
  modal.classList.remove('como-menu');
  modal.dataset.codexSurface = '';
  cx.className = 'modal-cx cx-term';
  cx.onclick = (e) => e.stopPropagation();
  const fechar = () => { cx.className = 'modal-cx'; P.fecharTerminal = null; fecharModal(P); };
  P.fecharTerminal = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); };
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>';
  $('.mo-tit', cx).textContent = titulo;
  $('.mo-x', cx).onclick = fechar;
  const corpo = document.createElement('div');
  corpo.className = 'mo-lista';
  cx.appendChild(corpo);
  return corpo;
}

function mostrarMudancasDoTurno(P, mudancas, diffTurno) {
  const corpo = abrirJanelaLarga(P, 'O que mudou neste turno');
  if (diffTurno) {
    // o Codex manda o diff agregado pronto (turn/diff/updated): desenha como o do git
    const box = document.createElement('div');
    box.className = 'dif dif-git';
    for (const linha of String(diffTurno).split('\n').slice(0, 4000)) {
      const l = document.createElement('div');
      const t = linha.startsWith('+') && !linha.startsWith('+++') ? 'mais'
        : linha.startsWith('-') && !linha.startsWith('---') ? 'menos'
        : linha.startsWith('@@') || linha.startsWith('diff --git') ? 'pula' : 'igual';
      l.className = 'dl ' + t;
      l.textContent = linha;
      box.appendChild(l);
    }
    corpo.appendChild(box);
    return;
  }
  for (const ed of (mudancas || [])) {
    const tit = document.createElement('div');
    tit.className = 'menu-secao';
    // so o nome do arquivo: o caminho inteiro em maiuscula ocupava tres linhas do cabecalho
    tit.textContent = String(ed.arquivo || 'arquivo').split('/').pop() || 'arquivo';
    tit.title = ed.arquivo || '';
    corpo.appendChild(tit);
    corpo.appendChild(cartaoDeDiff(P, ed));     // o mesmo cartao verde/vermelho do passo
  }
  if (!(mudancas || []).length) corpo.innerHTML = '<div class="mo-carregando">Nenhuma mudança de arquivo neste turno.</div>';
}

/* ===================== PRINTS DO AGENTE =====================
   Imagem dentro do resultado de uma ferramenta (ele tirou um print) vira miniatura no proprio
   passo; clique abre grande no VISOR — nao no .p-modal, que quebraria a escada do Esc.
   Antes a imagem era jogada fora e so' sobrava o base64 em texto. */
function mostrarPrintsDoPasso(P, d, imagens) {
  const lista = (imagens || []).filter((im) => im && im.dados).slice(0, 4);
  if (!lista.length) return;
  P.printsTurno = P.printsTurno || [];
  // a faixa e IRMA do .exec-t: o .exec-bd nasce fechado, e la dentro o print ficaria invisivel
  let cx = d ? $('.pa-imgs', d) : null;
  if (d && !cx) { cx = document.createElement('div'); cx.className = 'pa-imgs'; d.appendChild(cx); }
  for (const im of lista) {
    const src = 'data:' + (im.mime || 'image/png') + ';base64,' + im.dados;
    if (P.printsTurno.length < 40) P.printsTurno.push(src);
    if (!cx) continue;
    const img = document.createElement('img');
    img.className = 'pa-img';
    img.src = src;
    img.alt = 'print tirado pelo agente';
    img.title = 'Print que o agente tirou — clique pra ver grande';
    img.addEventListener('click', (e) => { e.stopPropagation(); verImagemGrande(P, src); });
    cx.appendChild(img);
  }
  // Receber um print preserva a escolha do usuário: só o clique abre os comandos.
  scroll(P);
}
function mostrarPrintsDoTurno(P, lista) {
  const corpo = abrirJanelaLarga(P, 'O que ele viu neste turno');
  corpo.classList.add('mo-prints');
  for (const src of (lista || [])) {
    const img = document.createElement('img');
    img.className = 'mo-print';
    img.alt = 'print tirado pelo agente';
    img.src = src;
    img.addEventListener('click', () => verImagemGrande(P, src));
    corpo.appendChild(img);
  }
}
/* Ver grande: o VISOR do painel, o mesmo do verArquivo. De proposito NAO e o .p-modal — ele
   entra antes do visor na escada do Esc e faria um Esc fechar a janelinha errada. */
function verImagemGrande(P, src) {
  const v = $('.p-visor', P.el);
  const corpo = $('.visor-corpo', v);
  posicionarVisor(v);
  v.classList.remove('hidden');
  v.onclick = (e) => { if (e.target === v) fecharVisor(P); };
  $('.visor-nome', v).textContent = 'Print do agente';
  cabecaVisor(v, 'Print do agente', '', 'image');
  $('.visor-x', v).innerHTML = ico('x');
  $('.visor-x', v).onclick = () => fecharVisor(P);
  // este print nao e' um arquivo no disco: nao ha o que abrir no Mac
  const abrir = $('.visor-abrir', v);
  abrir.classList.remove('hidden');   // ver um arquivo da VPS antes esconde este botao: repoe
  abrir.innerHTML = ico('image');
  abrir.onclick = null;
  abrir.title = 'Print do agente — não é um arquivo no Mac';
  corpo.innerHTML = '';
  const img = document.createElement('img');
  img.src = src;
  img.alt = 'print tirado pelo agente';
  corpo.appendChild(img);
}

/* ===================== AVISO DO AGENTE (PushNotification) =====================
   O agente decidiu que voce precisa saber de algo AGORA. O CLI, sem terminal, descartava
   ("not sent"); o main intercepta a chamada e ela chega aqui: cartao que FICA na conversa,
   painel piscando e aviso do sistema. */
function avisoDoAgente(P, texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return;
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'aviso-agente';
  d.innerHTML = '<span class="ag-ic"></span><span class="ag-txt"></span>';
  $('.ag-ic', d).innerHTML = ico('zap');
  $('.ag-txt', d).textContent = t;
  d.setAttribute('role', 'status');
  // sela a caixa de passos (P.execEl = null): o passo da propria notificacao, que o main manda
  // logo em seguida, abre outra caixa EMBAIXO do cartao, e nao acima dele
  limparPassos(P);
  P.chat.appendChild(d);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P);
  piscar(P);
  /* Aviso do sistema SO' quando ele nao esta vendo este painel: fora da janela, com a janela
     escondida, ou com outra aba de projeto na frente. Olhando pro chat, o cartao amarelo e o
     painel piscando ja dizem tudo — a notificacao ali seria so barulho. */
  const naFrente = document.hasFocus() && !document.hidden && abaAtiva && P.aid === abaAtiva.id;
  if (naFrente) return;
  const nome = P.titulo || nomePasta(P.cwd) || 'Painel';
  try { window.api.avisarAgente({ paneId: P.id, titulo: 'Cockpit — ' + nome, texto: t }); } catch {}
}

/* ============ envio ============ */
/* Nome da aba: o quadro cola no campo um cabecalho FIXO antes de ele escrever o pedido.
   Se o nome saisse dai, todo chat que comeca por desenho se chamaria "Desenhei um fluxograma
   no quadro…" e ele nao distinguiria um do outro na lista. Entao tiro o pedaco colado, fico
   com o que ELE digitou e, so se ele nao digitou nada, uso o resumo do desenho
   ("Fluxo de 3 caixas e 1 decisao, de Inicio ate Descarta"). */
function nomeDaConversa(P, text, anexos) {
  const curto = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const q = P.quadroColado;
  const colado = q && q.texto ? q.texto.trim() : '';
  if (colado && text.includes(colado)) {
    const dele = curto(text.split(colado).join(' '));
    if (dele.length >= 4) return dele;
    if (q.resumo) return curto(q.resumo);
  }
  const dele = curto(text);
  if (dele) return dele;
  /* Print colado sem uma palavra: o nome sai do proprio arquivo, senao a aba nasce sem nome
     e ele nao acha a conversa na lista depois. */
  if (anexos && anexos.length) {
    const nome = String(anexos[0].path || '').split('/').pop() || 'imagem';
    return curto(anexos.length > 1 ? (anexos.length + ' arquivos: ' + nome) : nome);
  }
  if (q && q.resumo) return curto(q.resumo);
  return dele;
}
/* Monta o que SAI para o motor. Quando ele nao digitou nada, a mensagem E o anexo: nao pode
   comecar com duas linhas em branco, senao o motor recebe um texto que abre vazio. */
function montarEnvio(text, anexos) {
  if (!anexos || !anexos.length) return text;
  const lista = 'Arquivos que anexei (abra cada um antes de responder):\n'
    + anexos.map(a => '- ' + a.path).join('\n');
  return text ? (text + '\n\n' + lista) : lista;
}
function escolhasCodex(P) {
  if (P.engine !== 'codex') return {};
  return { model: modeloSemOrigem(P.model) || undefined, cwd: P.cwd,
    approval: modoDe(P).id, effort: esforcoDe(P), serviceTier: P.serviceTier || undefined,
    collaborationMode: P.collaborationMode || 'default', experimentalContext: !!P.experimentalContext };
}
function prepararEscolhasEnvio(P) {
  if (P.engine !== 'codex') return null;
  // A retomada informa as escolhas do turno antigo. O pedido atual precisa atravessar
  // esse await intacto, até turn/start aceitar as escolhas novas.
  const envio = { desired: escolhasCodex(P), revision: P.settingsRevision || 0,
    phase: 'starting', confirmed: null };
  P.settingsSend = envio; P.settingsPending = true;
  pintarControlesCodex(P); return envio;
}
function concluirEscolhasEnvio(P, envio, aceito) {
  if (!envio || P.settingsSend !== envio) return;
  P.settingsSend = null;
  if ((P.settingsRevision || 0) !== envio.revision) { pintarControlesCodex(P); return; }
  P.settingsPending = !aceito || !!(envio.confirmed && envio.confirmed.pending);
  if (aceito && envio.confirmed) aplicarSettingsCodex(P, envio.confirmed);
  else pintarControlesCodex(P);
}
function envioComAnexos(P, text, anexos) {
  return { text: P.engine === 'codex' ? text : montarEnvio(text, anexos),
    attachments: anexos || [], displayText: text };
}
function juntarNaFila(P, pacote) {
  const antes = typeof P.queued === 'string' ? { text: P.queued, displayText: P.queued } : P.queued;
  P.queued = antes ? { text: [antes.text, pacote.text].filter(Boolean).join('\n\n'),
    displayText: [antes.displayText, pacote.displayText].filter(Boolean).join('\n\n'),
    attachments: [...(antes.attachments || []), ...(pacote.attachments || [])] } : pacote;
}
function reporAnexos(P, anexos) {
  for (const a of anexos) if (!P.anexos.some(x => x.path === a.path)) P.anexos.push(a);
  pintarAnexos(P);
}
function recuperarEnvio(P, bolha, text, anexos) {
  if (P.queued) { const q = P.queued; P.queued = null; devolverFilaAoCampo(P, q); }
  tirarBolha(P, bolha);
  const campo = $('.p-input', P.el);
  campo.value = [text, campo.value].filter(Boolean).join('\n\n');
  campo.style.height = 'auto';
  reporAnexos(P, anexos);
  window.dispatchEvent(new Event('cockpit:salvar-rascunhos'));
}
function painelAindaAtual(P, revisao) {
  return panes.get(P.id) === P && (P.revisaoConversa || 0) === revisao;
}
function invalidarConversa(P) {
  P.revisaoConversa = (P.revisaoConversa || 0) + 1;
  clearTimeout(P.filaTimer); P.filaTimer = null;
  P.carregandoHistorico = false; P.settingsSend = null;
  // se a conversa muda no meio de um envio, o pontinho "pendente" nao pode ficar
  // aceso pra sempre: os pontos de guarda de send()/agendarFila saem antes de
  // concluirEscolhasEnvio quando isso acontece, entao centraliza aqui
  P.settingsPending = false;
}

/* A fila continua pertencendo ao painel durante os 150 ms de espera. Tirar antes
   fazia um timer antigo mandar mensagens depois de fechar ou trocar a conversa. */
function agendarFila(P) {
  if (P.filaTimer || !P.queued) return;
  const revisao = P.revisaoConversa || 0;
  P.filaTimer = setTimeout(async () => {
    P.filaTimer = null;
    if (!painelAindaAtual(P, revisao) || P.trocando || P.busy || !P.queued) return;
    const pacote = P.queued;
    P.queued = null;
    if (!P.started) { devolverFilaAoCampo(P, pacote); return; }
    // Só estas bolhas foram enviadas. Outra mensagem pode entrar durante o await.
    const fila = P.filaMsgs || [];
    P.filaMsgs = [];
    P.busy = true; P.comecouEm = Date.now(); setDot(P, 'busy');
    comecarTurno(P); limparContinuar(P); trabalhando(P);
    const escolhasDoEnvio = prepararEscolhasEnvio(P);
    try {
      const q = typeof pacote === 'string' ? { text: pacote } : pacote;
      if (escolhasDoEnvio) escolhasDoEnvio.phase = 'sending';
      const ok = await window.api.paneSend({ paneId: P.id, engine: P.engine,
        text: q.text || '', attachments: q.attachments || [],
        ...(escolhasDoEnvio ? escolhasDoEnvio.desired : {}) });
      if (!painelAindaAtual(P, revisao)) return;
      if (ok === false || ok && (ok.error || ok.ok === false)) throw new Error('não foi entregue');
      concluirEscolhasEnvio(P, escolhasDoEnvio, true);
      for (const f of fila) if (f.el) f.el.classList.remove('esperando');
    } catch (e) {
      if (!painelAindaAtual(P, revisao)) return;
      concluirEscolhasEnvio(P, escolhasDoEnvio, false);
      P.busy = false; P.started = false;
      // Falha do motor devolve também as mensagens recebidas enquanto ele caía.
      const depois = P.queued;
      P.queued = pacote;
      if (depois) juntarNaFila(P, typeof depois === 'string' ? { text: depois, displayText: depois } : depois);
      const devolver = P.queued; P.queued = null;
      P.filaMsgs = [...fila, ...(P.filaMsgs || [])];
      setDot(P, 'off'); pararTrabalho(P); limparPassos(P);
      note(P, 'A mensagem que estava na fila não foi enviada. Ela voltou para a caixa: é só mandar de novo.', true);
      devolverFilaAoCampo(P, devolver);
    }
  }, 150);
}
async function send(P) {
  if (P.trocando || P.carregandoHistorico || motoresTrocandoConta.has(P.engine) || panes.get(P.id) !== P) return;
  const revisao = P.revisaoConversa || 0;
  const inp = $('.p-input', P.el);
  /* Enter no campo vazio COM o chip "Continuar" na tela = manda "continue". O chip so nasce
     no fim de um turno desta conversa, entao chat recem-aberto nao liga o motor sem querer.
     Nao vale durante o ditado (campo vazio ali e falha de captacao, nao pedido), nem com
     anexo ou desenho do quadro pendurado — isso e esquecimento, e o texto ainda vem. */
  /* Redesenho: o chip saiu da caixa e mora no fim da conversa. Rolada para cima, ele sai da vista
     e o Enter vazio mandaria "continue" sem nenhum sinal na tela. Aí o Enter só desce até o chip
     (ele aparece, e o próximo Enter continua), como era quando o chip ficava sempre à vista. */
  const chipCont = $('.p-cont', P.el);
  if (!inp.value.trim() && chipCont && podeContinuar(P)
      && !(P.anexos || []).length && !P.quadroColado
      && VIVO.P !== P && DITADO.P !== P) {
    if (chipNaVista(P, chipCont)) inp.value = 'continue';
    else chipCont.scrollIntoView({ block: 'nearest' });
  }
  const text = inp.value.trim();
  if (text || (P.anexos || []).length || P.quadroColado) limparSugestoes(P);
  /* Print colado sozinho TEM de sair. Antes o envio exigia texto: ele colava a imagem, apertava
     Enter e nao acontecia nada — a fichinha ficava presa no campo e ele achava que tinha
     mandado. Agora o anexo (ou o desenho do quadro) ja basta; so o campo totalmente vazio,
     sem nada anexado, e que nao envia. */
  if (!text && !(P.anexos || []).length && !P.quadroColado) return;
  /* A mensagem VAI sair: soltar o microfone. Fica DEPOIS da saída acima de propósito — Enter
     no campo vazio no meio do ditado é falha de captação, e ali o ditado tem de continuar.
     `guardarTexto`: o texto já foi lido para `text` e o campo é limpo logo abaixo. */
  vozSoltar(P, { guardarTexto: true });
  /* A mensagem VAI sair: a busca do "@" que ainda estiver em voo morre aqui. Sem isto ela
     seguia viva, porque o campo e limpo NA MAO logo abaixo (inp.value = '') e limpar por
     codigo nao dispara o evento 'input' — o unico lugar de onde o cancelamento saía. Na VPS
     o relogio de 450 ms acordava DEPOIS do envio e abria o menu de arquivos por cima da
     resposta que estava chegando. */
  pararBuscaDeArquivos(P);
  soltarNavArquivos(P);   // e o atalho de setas sai junto: sem menu, sem dono

  if (P.busy || P.queued) {
    const anx = P.anexos.slice(); P.anexos = []; pintarAnexos(P);
    P.quadroColado = null;
    inp.value = ''; inp.style.height = 'auto';
    guardarPrompt(text);            // pra trazer de volta com a seta pra cima
    P.navHist = undefined;
    const bolha = userMsg(P, text, anx);
    const pacote = envioComAnexos(P, text, anx);
    // ja havia uma esperando? Junta em vez de trocar: o `P.queued = envio` de antes apagava a
    // primeira em silencio — a bolha dela ficava na tela e a mensagem nunca era enviada.
    if (P.envio === 'entra' && P.busy) {
      const nota = avisoEnvio(P, 'Mandando para dentro do trabalho…');
      let r;
      try { r = await window.api.paneSteer({ paneId: P.id, engine: P.engine,
        text: ENTRA_MSG + pacote.text, attachments: anx }); } catch { r = { ok: false }; }
      if (!painelAindaAtual(P, revisao)) return;
      if (nota) {
        nota.textContent = r && r.ok ? 'Entregue no meio do trabalho' : 'Ficou na fila';
        nota.title = r && r.ok ? 'Ele escolhe se atende agora ou ao terminar.' : 'Não deu para entrar agora. Começa assim que ele terminar.';
      }
      if (!(r && r.ok)) { juntarNaFila(P, pacote); marcarNaFila(P, bolha, text); if (!P.busy) agendarFila(P); }
    } else {
      juntarNaFila(P, pacote);
      marcarNaFila(P, bolha, text);
      avisoEnvio(P, 'Na fila', 'Começa assim que ele terminar.');
      if (!P.busy) agendarFila(P);
    }
    return;
  }
  const escolhasDoEnvio = prepararEscolhasEnvio(P);
  const pedidoCodex = escolhasDoEnvio ? escolhasDoEnvio.desired : {};
  const historicoAnterior = P.hist.length;
  const anexos = P.anexos.slice();
  P.anexos = []; pintarAnexos(P);
  inp.value = ''; inp.style.height = 'auto';
  guardarPrompt(text);              // pra trazer de volta com a seta pra cima
  P.navHist = undefined;
  const bolha = userMsg(P, text, anexos);
  if (!P.titulo) { P.titulo = nomeDaConversa(P, text, anexos); pintarNome(P); nomearCurto(P, 'comeco'); }
  P.quadroColado = null;

  if (!P.started) {
    P.busy = true;
    setDot(P, 'busy');
    note(P, 'Ligando o ' + nomeDoMotor(P.engine) + '…');   // [EDITA 12.4] no ACP dizia "Ligando o Claude…"
    try {
      /* O FIO da conversa (o id que vai no --resume) nao pode ser jogado fora enquanto o motor
         novo nao confirmar que abriu. Antes ele era zerado no instante em que o processo subia:
         se esse processo morresse antes de abrir a conversa — que e exatamente o que acontece
         quando o limite de uso ainda nao voltou ou a internet ainda esta fora — o id sumia para
         sempre. A mensagem seguinte entao subia um chat DO ZERO, e como o arranque injeta a
         memoria da PASTA (trabalhos de outros chats do mesmo cliente), o "continue" saia
         continuando o trabalho de outra conversa. O fio agora so e solto em 'sessao-sumiu'. */
      const fio = P.sessaoId || P.resumeId || null;
      P.resumeId = fio;          // guardado ate o motor confirmar que reabriu esta conversa
      P.sessaoId = null;         // sessaoId = conversa do processo VIVO; volta no evento 'sessao'
      // Rede de seguranca: sem fio e com conversa na tela, o chat nasceria cego e pegaria carona
      // na memoria de outro chat. Vai junto o que foi dito AQUI, e a ordem de ignorar o resto.
      // O contexto vai junto em silencio: a tarja vermelha aparecia no comeco de quase todo chat
      // e nao pedia nada dele. O comportamento continua igual, so o recado saiu da tela.
      if (!fio && historicoAnterior && !P.passarContexto) {
        const pedaco = P.hist.slice(0, historicoAnterior);
        // R3-012: só existe queda de verdade se ALGUMA resposta do motor tiver chegado antes.
        // Sem isso, a 1a tentativa que nem chegou a começar (processo caiu antes de responder)
        // virava "ATENÇÃO: esta conversa caiu" pra uma conversa que nunca existiu.
        const motivoContexto = pedaco.some(h => h.quem !== 'Você') ? undefined : 'primeira-tentativa';
        P.passarContexto = montarContexto({ ...P, hist: pedaco }, true, motivoContexto);
        console.log('[cockpit] sem fio: mandei o contexto desta conversa junto');
      }
      const inicio = await window.api.paneStart({
        paneId: P.id, engine: P.engine, cwd: P.cwd,
        model: modeloSemOrigem(P.model) || undefined,
        billing: modeloPorCreditos(P.model) ? 'api' : 'plan',
        approval: modoDe(P).id, effort: esforcoDe(P), resumeId: fio || undefined,
        // ramo de verdade (leva 8.3): o Claude nasce com --fork-session e leva a conversa
        // inteira, sem escrever dentro da de origem. Sem isto o campo nem é mandado.
        fork: P.forkPendente || undefined,
        /* branch isolada (leva 10.5). Só no Claude e só fora da VPS: a flag -w é do Claude, e
           o repositório quem confere é o Mac. Sem worktree o campo nem é mandado. */
        worktree: (P.engine === 'claude' && !NA_VPS(P.cwd) && P.worktree) || undefined,
        ...pedidoCodex,
      });
      if (!painelAindaAtual(P, revisao)) return;
      if (inicio === false || inicio && (inicio.error || inicio.ok === false)) throw new Error(inicio && inicio.error || 'O motor não abriu.');
      /* Esta mesma conversa ja esta aberta em outra tela. O Mac recusou subir um segundo agente
         nela — seriam dois mexendo no mesmo historico e na mesma pasta ao mesmo tempo. A fala
         volta inteira pro campo, com os anexos, e o chat conta o que houve. Mandar de novo
         assume a conversa aqui e desliga o agente do outro lado. */
      if (inicio && inicio.jaAberta) {
        P.busy = false; concluirEscolhasEnvio(P, escolhasDoEnvio, false);
        recuperarEnvio(P, bolha, text, anexos);
        setDot(P, 'off');
        note(P, 'Esta conversa já está aberta ' + (inicio.onde || 'em outra tela')
          + '. Mande de novo para trazer ela para cá — o chat de lá para.', true);
        return;
      }
      // Uma versao antiga podia guardar aqui o numero da conversa do outro motor. O processo
      // principal se recupera abrindo outra; antes de mandar a fala, esta tela repoe o contexto.
      if (inicio && inicio.nova && historicoAnterior && !P.passarContexto) {
        const pedaco = P.hist.slice(0, historicoAnterior);
        const motivoContexto = pedaco.some(h => h.quem !== 'Você') ? undefined : 'primeira-tentativa';
        P.passarContexto = montarContexto({ ...P, hist: pedaco }, true, motivoContexto);
      }
      P.started = true; P.ultraAvisado = false;   // processo novo: liberar o ultracode de novo
      P.forkPendente = false;   // o ramo já nasceu no start; não pode forkar de novo
    } catch (e) {
      if (!painelAindaAtual(P, revisao)) return;
      P.busy = false; concluirEscolhasEnvio(P, escolhasDoEnvio, false);
      recuperarEnvio(P, bolha, text, anexos);
      setDot(P, 'off'); note(P, 'Não consegui ligar: ' + (e && e.message || e), true); return;
    }
  }
  P.busy = true; P.comecouEm = Date.now(); setDot(P, 'busy');
  comecarTurno(P);          // relogio e rastro DESTE turno (uso, mudancas, prints)
  P.blocks.clear(); P.codexPlan = null; P.codexEstados = new Map();
  // sem zerar a legenda aqui, a ultima frase do turno ANTERIOR aparece colada no
  // "trabalhando" do turno novo, como se ele ainda estivesse naquilo
  P.trabOque = '';
  pararTrabalho(P); limparPassos(P); limparContinuar(P); trabalhando(P);
  subirNaLista(P);
  let envio = envioComAnexos(P, text, anexos).text;
  const contextoDoEnvio = P.passarContexto;
  const ultraAntes = P.ultraAvisado;
  /* O contexto entra na FRENTE do 'envio' (que ja carrega a lista de anexos), nunca do 'text' cru:
     colando no 'text' a lista "Arquivos que anexei" era jogada fora, e o caminho do print ou do
     desenho do quadro nunca chegava ao motor — a fichinha aparecia na tela e nada era lido. */
  if (P.passarContexto) { envio = P.passarContexto + envio; P.passarContexto = null; }
  // Máximo no Claude = ultracode: uma vez por processo, a liberação vai grudada na mensagem
  if (P.engine === 'claude' && esforcoDe(P) === 'max' && !P.ultraAvisado) {
    envio = ULTRACODE_MSG + envio; P.ultraAvisado = true;
    avisoEnvio(P, 'Esforço máximo', 'Liberei os workflows (vários agentes em paralelo) e o modelo por tarefa (Haiku triagem · Sonnet execução · Opus planejamento).');
  }
  try {
    if (escolhasDoEnvio) escolhasDoEnvio.phase = 'sending';
    const ok = await window.api.paneSend({ paneId: P.id, engine: P.engine, text: envio,
      attachments: anexos, ...pedidoCodex });
    if (!painelAindaAtual(P, revisao)) return;
    const aceito = ok !== false && !(ok && (ok.error || ok.ok === false));
    concluirEscolhasEnvio(P, escolhasDoEnvio, aceito);
    // false = o motor caiu antes de receber. Sem isto o chat ficava em "trabalhando..."
    // para sempre, esperando uma resposta que nunca vem.
    if (!aceito) {
      if (!P.passarContexto) P.passarContexto = contextoDoEnvio;
      P.ultraAvisado = ultraAntes;
      // P.started TEM de voltar a false, senao o proximo envio pula o religar e repete
      // a mesma frase para sempre. (No Claude o engine-down ja faz isso; no Codex nao vem.)
      P.started = false; P.resumeId = P.sessaoId || P.resumeId;
      P.busy = false; setDot(P, 'off'); pararTrabalho(P); limparPassos(P);
      note(P, 'O motor não estava no ar e a mensagem não chegou. Manda de novo que ele religa.', true);
      /* o texto volta para o campo E a bolha sai da tela junto. Antes so o texto voltava: a
         bolha ficava, e cada Enter empilhava mais uma bolha e mais um item no P.hist. */
      recuperarEnvio(P, bolha, text, anexos);
      /* o anexo tambem volta para o campo. Sem isto, o print que ele colou sem escrever nada
         sumia de vez quando o motor estava fora do ar: o texto voltava vazio e a fichinha
         ja tinha sido apagada do campo la em cima. */
    }
  }
  catch (e) { if (!painelAindaAtual(P, revisao)) return;
    if (!P.passarContexto) P.passarContexto = contextoDoEnvio;
    P.ultraAvisado = ultraAntes;
    concluirEscolhasEnvio(P, escolhasDoEnvio, false);
    // P.started TEM de voltar a false, senao o proximo envio pula o religar e repete a mesma
    // falha para sempre (mesmo motivo do ramo `!aceito` acima e do catch de agendarFila).
    P.started = false; P.resumeId = P.sessaoId || P.resumeId;
    P.busy = false; pararTrabalho(P); limparPassos(P);
    recuperarEnvio(P, bolha, text, anexos);
    setDot(P, 'idle'); note(P, 'Falhou: ' + (e && e.message || e), true); }
}

/* ============ eventos vindos do motor ============ */
/* Erros que antes morriam calados agora aparecem. Vale para os dois lados:
   o processo principal manda "app:erro", e aqui na tela pegamos o que estoura no renderer.
   Sem isto, um tropeco no meio de desenhar a resposta deixava o chat preso em "trabalhando"
   para sempre, sem nenhuma pista do que houve. */
/* Arrastar um arquivo e soltar em qualquer lugar que NAO seja a caixa de texto fazia a janela
   navegar para o arquivo e a tela do Cockpit sumir. Aqui a pagina inteira recusa o "soltar";
   quem aceita de verdade e so a caixa de texto, que trata o evento antes deste. */
document.addEventListener('dragover', (e) => {
  if (e.defaultPrevented) return;                 // a caixa de texto ja aceitou este arrasto
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
});
document.addEventListener('drop', (e) => { if (!e.defaultPrevented) e.preventDefault(); });

/* O main atualiza os motores sozinho e avisa aqui. O recado importa: sem ele a pessoa
   continuaria vendo o aviso de versao velha da abertura e iria ao Terminal a toa. */
if (window.api.onMotorAtualizado) {
  window.api.onMotorAtualizado((p) => {
    if (!p || !p.engine) return;
    const alvo = focusPane || panes.values().next().value;
    if (!alvo) return;
    note(alvo, nomeMotor(p.engine) + ' foi atualizado sozinho: ' + p.de + ' → ' + p.para
      + '. Os chats abertos seguem na versão antiga até terminarem; o próximo chat já nasce na nova.', true);
  });
}

let ultimoAvisoMain = 0;
if (window.api.onErroApp) {
  window.api.onErroApp((p) => {
    console.error('erro no processo principal:', p);
    // um erro em laco mandaria uma tarja por segundo e entupiria o chat: no maximo uma a cada 15s
    const agora = Date.now();
    if (agora - ultimoAvisoMain < 15000) return;
    ultimoAvisoMain = agora;
    try {
      const alvo = focusPane || panes.values().next().value;
      if (alvo) avisoTemp(alvo, (p && p.texto) || 'Erro interno.');
    } catch {}
  });
}
let ultimoAvisoErro = 0;
window.addEventListener('error', (e) => {
  console.error('erro na tela:', e && (e.error || e.message));
  // no maximo um aviso a cada 15s, senao um erro em laco enche o chat de tarja
  const agora = Date.now();
  if (agora - ultimoAvisoErro < 15000) return;
  ultimoAvisoErro = agora;
  try {
    const alvo = focusPane || panes.values().next().value;
    if (alvo) avisoTemp(alvo, 'Deu um erro na tela: ' + ((e && (e.message || (e.error && e.error.message))) || 'sem detalhe') + '. Se algo travou, feche e abra o chat.');
  } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('promessa rejeitada na tela:', e && e.reason);
});

function receberEventoPane(ev) {
  const P = panes.get(ev.paneId); if (!P) return;
  if (ev.globalEvent && window.api.onCodexEvent) return;
  switch (ev.kind) {
    case 'account': case 'connectors':
      if (!window.api.onCodexEvent) receberEventoGlobalCodex({ ...ev, destino: NA_VPS(P.cwd) ? 'vps' : 'local' });
      break;
    case 'busy': P.busy = true; setDot(P, 'busy'); comecarTurno(P); trabalhando(P); break;
    // o motor abriu (ou reabriu) a conversa: este id passa a ser o fio guardado
    case 'sessao': {
      const mudou = P.sessaoId !== ev.id;
      P.sessaoId = ev.id; P.resumeId = ev.id; P.sessaoFile = ev.file || '';
      // 25/09: primeira conversa do motor depois de uma troca de IA: costura com a de antes
      if (P.parteAnterior) ligarParteAnterior(P);
      // grava o fio no disco NA HORA. Antes so ia junto do proximo salvamento por outro motivo:
      // fechar o app logo depois de a conversa nascer perdia o numero dela, e ao reabrir o chat
      // voltava sem fio — a mesma armadilha de continuar o trabalho de outra conversa.
      if (mudou) savePanes();
      break;
    }
    // o Claude disse que essa conversa nao existe mais: agora sim o fio se solta
    case 'sessao-sumiu':
      /* 25/09: a parte de agora sumiu, mas a conversa tinha partes antes dela (troca de IA): a
         nova que vai nascer costura na ultima que ainda existe, e a lista continua mostrando uma
         conversa so. */
      if (!P.parteAnterior && Array.isArray(P.partesAnteriores) && P.partesAnteriores.length) {
        P.parteAnterior = P.partesAnteriores[P.partesAnteriores.length - 1];
        P.partesAnteriores = P.partesAnteriores.slice(0, -1);
      }
      P.sessaoId = null; P.resumeId = null; P.fioSolto = Date.now();
      zerarContexto(P);         // a conversa velha sumiu: o medidor nao pode continuar com o numero dela
      P.forkPendente = false;   // leva 8.3: fio solto, a intencao de ramificar morre junto
      note(P, 'Esta conversa não existe mais no Claude. A próxima mensagem começa uma nova, levando junto o que já foi dito aqui.', true);
      savePanes();
      break;
    case 'text-delta': textDelta(P, ev.id, ev.text); break;
    case 'think-delta': thinkDelta(P, ev.text); break;
    case 'text-final': textFinal(P, ev.id, ev.text); break;
    case 'tool-start':
      if (Array.isArray(ev.tarefas)) { desenharPlano(P, ev.tarefas); savePanes(); }
      toolStart(P, ev.id, ev.name, ev.arg, { edicao: ev.edicao, tarefas: ev.tarefas }); break;
    case 'sugestao': mostrarSugestoes(P, ev.itens); break;
    case 'tool-output': toolOutput(P, ev.id, ev.text); break;
    case 'tool-end': toolEnd(P, ev.id, ev.output, ev.error, ev.imagens); break;
    // o agente te chamou no meio do trabalho (PushNotification interceptada no main)
    case 'aviso-agente': avisoDoAgente(P, ev.texto); break;
    /* o recorte da tela ficou pronto no main e virou arquivo: entra como anexo DESTE painel.
       R4: o recado de sucesso vai por avisoTemp — note() sem `true` nao aparece na tela. */
    case 'anexo-pronto':
      anexar(P, [ev.arquivo]).then(() => {
        if ((P.anexos || []).some((x) => x && x.path === ev.arquivo)) {
          avisoTemp(P, (ev.origem === 'recorte' ? 'Recorte' : 'Imagem') + ' anexado. Escreva o que quer que ele faça.');
        }
        const campo = $('.p-input', P.el); if (campo) campo.focus();
      });
      break;
    // rastro do turno: quanto ele consumiu e o diff agregado que o Codex manda pronto
    case 'turno-uso': P.usoTurno = { entrada: ev.entrada || 0, saida: ev.saida || 0 }; break;
    case 'diff-turno': P.diffTurno = ev.diff || ''; break;
    case 'compactou': estadoCodex(P, 'compactacao', 'Conversa resumida', 'O resumo liberou espaço para continuar.', true); break;
    case 'compacting': estadoCodex(P, 'compactacao', 'Resumindo a conversa', ev.message || 'Guardando o contexto para continuar.'); break;
    case 'question': perguntaCodex(P, ev); break;
    case 'question-resolved': encerrarPerguntaCodex(P, ev.key); break;
    case 'plan': planoCodex(P, ev); break;
    case 'generated-image': imagemGeradaCodex(P, ev); break;
    case 'waiting': esperaCodex(P, ev); break;
    case 'goal': metaCodex(P, ev); break;
    case 'settings': aplicarSettingsCodex(P, ev); break;
    case 'tokens':
      if (ev.janela) { P.janela = ev.janela; lembrarJanela(P, ev.janela); }
      P.tokens = ev.total || 0;
      pintarTokens(P);
      break;
    case 'api-usage': break;   // era o contador do Astra por créditos, que saiu da tela
    case 'janela': P.janela = ev.total; lembrarJanela(P, ev.total); pintarTokens(P); break;
    case 'agentes': agentesEvento(P, ev); break;
    case 'voz': vozEvento(P, ev); break;
    case 'note': note(P, ev.text, ev.error); break;
    case 'turn-end':
      marcarFimDoTurno(P);   // PRIMEIRA linha: o carimbo precisa do P.t0 antes de qualquer limpeza
      avisarQueTerminou(P);
      P.busy = false;
      if (P.sugestoesPendentes) mostrarSugestoes(P, P.sugestoesPendentes);
      escondePerm(P, false);   // perguntas não bloqueantes continuam respondíveis
      marcarRespostaNova(P);   // antes do setDot: ele repinta o ponto já com o "nova"
      setDot(P, 'idle'); P.blocks.clear(); pararTrabalho(P); limparPassos(P);
      mostrarContinuar(P);
      atualizarGit(P);   // leva 10.4: o turno acabou; o chip mostra o que ele mexeu na pasta
      setTimeout(() => { if (!P.busy) { pararTrabalho(P); limparPassos(P); } }, 400);
      // nao zera mais o histCache aqui: zerar trocava a lista por "Carregando..." e derrubava
      // busca, filtro e favorito ate a releitura terminar. O loadHist ja sobrescreve o cache.
      setTimeout(() => lerUsoAposResposta(P.engine), 1500);
      salvarNomeCurto(P);
      nomearNoFimDoTurno(P);
      setTimeout(() => buscarNome(P), 1200);
      /* 25/09: com a lateral aberta, relê tambem a costura das conversas antes da lista: uma
         troca de IA gravada por outro chat ou pelo celular so entrava ao fechar e abrir a lateral */
      if (lateralAberta()) lerLigacoes().then(() => loadHist(P.engine, true));
      agendarFila(P);
      break;
    case 'engine-down': {
      // Guardar o FIO da conversa. Sem isto, a proxima mensagem subia um motor novo sem
      // --resume e comecava outra conversa do zero, calada: a tela continuava mostrando tudo
      // que foi dito, entao parecia que ele tinha ficado burro. Na aba da VPS, onde a ssh cai
      // sozinha, isso acontecia direto.
      // O fio NUNCA se solta numa queda: se este processo abriu a conversa, o id dele manda;
      // se caiu antes de abrir, vale o que ja estava guardado. Soltar aqui (como antes) fazia
      // a conversa se perder justamente na segunda queda seguida — limite que ainda nao voltou.
      P.resumeId = P.sessaoId || P.resumeId || null;
      P.started = false; P.busy = false;
      // O motor morreu: o que estava na fila morreu junto. Guardado, ele disparava sozinho no
      // proximo fim de turno — uma pergunta velha respondida do nada, minutos depois. Volta
      // para a caixa em vez de sumir.
      if (P.queued) { const q = P.queued; P.queued = null; devolverFilaAoCampo(P, q); }
      escondePerm(P);
      agMotorCaiu(P);
      setDot(P, 'off'); pararTrabalho(P); limparPassos(P); limparContinuar(P);
      // se o aviso de "esta conversa nao existe mais" acabou de sair, nao repetir outro recado
      // dizendo a mesma coisa com outras palavras
      if (!(P.fioSolto && Date.now() - P.fioSolto < 5000)) {
        note(P, P.resumeId
          ? 'A conexão caiu. A próxima mensagem religa e CONTINUA esta mesma conversa.'
          : 'A conexão caiu antes de a conversa ficar salva. A próxima mensagem começa uma nova.', true);
      }
      savePanes();
      break;
    }
    case 'approval': showApproval(P, ev); break;
    /* ===== leva 12.4/12.5: os três recados que só o motor ACP manda ===== */
    // o agente subiu e se apresentou: quem é, o que sabe fazer, e se retomou a conversa
    case 'acp-info': {
      P.acpInfo = ev;
      const bt = $('.p-model', P.el);
      if (bt && ev.agente) { bt.innerHTML = ico('brain') + '<span></span>' + ico('updown'); $('span', bt).textContent = ev.agente + (ev.versao ? ' ' + ev.versao : ''); }
      if (ev.modoAtual) P.acpModo = ev.modoAtual;
      break;
    }
    // os comandos "/" que ESTE agente anunciou; o menu os lê pelo skills:list
    case 'acp-comandos': P.acpComandos = ev.itens || []; break;
    case 'acp-modo': P.acpModo = ev.modo || ''; break;
  }
}
window.api.onPaneEvent(receberEventoPane);

/* O pedido de permissao vale so enquanto AQUELE turno daquele motor esta vivo. Sem apagar a
   tarja no fim do turno, na queda e na troca de motor, ela ficava pendurada pedindo autorizacao
   para um processo que ja morreu — e responder "sim" ali derrubava o chat que estava no lugar. */
function escondePerm(P, encerrarTodas = true) {
  if (P) { P.aprovacaoAtual = null; P.aprovacoesPendentes = []; }
  const bar = P && P.el && $('.pane-perm', P.el);
  if (bar) bar.classList.add('hidden');
  if (P && P.questions) for (const q of P.questions.values()) {
    if (!q.done && (encerrarTodas || !q.persisteEntreTurnos)) { q.done = true; q.el.classList.add('encerrada');
      $$('.cxq-input, button, input, select, textarea', q.el).forEach(x => { x.disabled = true; });
      const status = $('.cxq-status', q.el); if (status) status.textContent = 'Pedido encerrado.'; }
  }
  marcarEspera(P);                    // acabou a espera: a bolinha vermelha e a tarja saem juntas
}

/* ---- o pedido de autorização no desenho do redesenho (README, "Pilha inferior", item 2) ----
   Cabeçalho curto ("Editar arquivo", "Rodar comando") + "há 12s", o objeto em mono (o arquivo ou
   o comando INTEIRO: é o que ele vai autorizar, então nunca é cortado com reticências), a pasta
   embaixo em mono menor e, quando o motor mandou, o antes/depois. Os motores mandam o pedido em
   formatos diferentes (título + detalhe em texto); aqui ele só é separado em pedaços, sem perder
   nada do que já aparecia. */
function partesDoPedido(ev) {
  const VERBO = { Edit: 'Editar arquivo', MultiEdit: 'Editar arquivo', Write: 'Escrever arquivo',
    NotebookEdit: 'Editar notebook', Bash: 'Rodar comando', Read: 'Ler arquivo', Glob: 'Procurar arquivos',
    Grep: 'Procurar no código', WebFetch: 'Abrir página', WebSearch: 'Pesquisar na web', Task: 'Chamar agente' };
  const titulo = String(ev.title || '');
  // o Claude manda "Claude quer usar: Edit"; o ACP manda o nome da ferramenta em ev.tool
  const ferramenta = ev.tool || (/quer usar:\s*(\S+)/.exec(titulo) || [])[1] || '';
  /* O Codex manda "Rodar comando no seu Mac": no Mac é o normal, então o cabeçalho fica o curto do
     desenho. "na VPS" continua escrito: comando rodando em outra máquina é a exceção que ele
     precisa ver antes de permitir. */
  const cab = VERBO[ferramenta] || titulo.replace(/^(Rodar comando) no seu Mac$/, '$1') || 'Pedido de autorização';
  const linhas = String(ev.detail || '').split('\n');
  let caminho = '';
  // o Codex manda "comando\nem /pasta": a pasta desce para a linha de baixo, como no desenho
  if (linhas.length > 1 && /^em \S/.test(linhas[linhas.length - 1])) caminho = shortPath(linhas.pop().slice(3));
  let obj = linhas.join('\n').trim();
  // só um caminho de arquivo (sem espaço): nome do arquivo em cima, a pasta dele embaixo
  const arquivo = obj && !/\s/.test(obj) && obj.includes('/') ? obj
    : (!obj && ev.mudanca && ev.mudanca.arquivo) ? String(ev.mudanca.arquivo) : '';
  if (arquivo && !caminho) {
    const i = arquivo.lastIndexOf('/');
    obj = arquivo.slice(i + 1);
    if (i >= 0) caminho = shortPath(arquivo.slice(0, i) || '/');
  }
  return { cab, obj, caminho, porque: String(ev.reason || '') };
}
function pintarPedido(P, bar, ev) {
  const partes = partesDoPedido(ev);
  const pega = (s) => $(s, bar);
  const tit = pega('.pp-tit'); if (tit) tit.textContent = partes.cab;
  const txt = pega('.pp-txt'); if (txt) { txt.textContent = partes.obj; txt.classList.toggle('hidden', !partes.obj); }
  const cam = pega('.pp-cam'); if (cam) { cam.textContent = partes.caminho; cam.classList.toggle('hidden', !partes.caminho); }
  const por = pega('.pp-por'); if (por) { por.textContent = partes.porque; por.classList.toggle('hidden', !partes.porque); }
  const dif = pega('.pp-diff');
  if (dif) {
    dif.innerHTML = '';
    const m = ev.mudanca || null;
    const pedacos = m ? (m.partes || ((m.antes != null || m.depois != null) ? [{ antes: m.antes, depois: m.depois, linha: m.linha }] : [])) : [];
    /* número da linha (coluna de 36 em --label-3, como o diff dos passos): só quando o pedido diz
       onde o trecho começa (p.linha, do main.js). Sem isso a coluna fica de fora; número
       inventado seria pior do que nenhum. */
    const comNumero = pedacos.some(p => Number.isInteger(p.linha) && p.linha > 0);
    for (const p of pedacos) {
      const cru = linhasDoDiff(p.antes, p.depois);
      if (Number.isInteger(p.linha) && p.linha > 0) numerarDesde(cru, p.linha);
      for (const l of comContexto(cru)) {
        const linha = document.createElement('div');
        linha.className = 'ppd ' + (l.t === '+' ? 'mais' : l.t === '-' ? 'menos' : l.t === '@' ? 'pula' : 'igual');
        const sinal = document.createElement('span'); sinal.className = 'ppd-s';
        sinal.textContent = l.t === '+' ? '+' : l.t === '-' ? '−' : '';
        const texto = document.createElement('span'); texto.className = 'ppd-t'; texto.textContent = l.txt;
        if (comNumero) {
          const num = document.createElement('span'); num.className = 'ppd-n';
          num.textContent = l.n != null ? String(l.n) : '';
          linha.append(num);
        }
        linha.append(sinal, texto); dif.appendChild(linha);
      }
    }
    dif.classList.toggle('com-num', comNumero);
    dif.classList.toggle('hidden', !dif.children.length);
  }
  pintarHaPedido(P);
}
// "há 12s": quanto tempo o pedido está esperando. O relógio de baixo repinta a cada segundo.
function pintarHaPedido(P) {
  const ha = P && P.el && P.aprovacaoAtual && $('.pp-ha', P.el);
  if (ha) ha.textContent = 'há ' + duracaoCurta(Date.now() - (P.aprovacaoAtual.desde || Date.now()));
}
setInterval(() => { for (const P of panes.values()) if (P.aprovacaoAtual) pintarHaPedido(P); }, 1000);
/* O cartão sobe 8pt UMA vez, quando o pedido chega (.pp-chegando, redesign/caixa.css). A classe sai
   logo depois: presa no cartão, a animação rodava de novo toda vez que ele voltava para a aba (o
   painel sai do display:none), e trocar de aba não tem animação. Pedido que chega com a aba no
   fundo já perdeu a classe quando ele abre a aba: aparece parado, sem animação. */
function chegadaDoPedido(bar) {
  if (!bar) return;
  clearTimeout(bar.chegadaTimer);
  bar.classList.remove('pp-chegando');
  void bar.offsetWidth;               // o próximo pedido da fila anima de novo, do começo
  bar.classList.add('pp-chegando');
  bar.chegadaTimer = setTimeout(() => bar.classList.remove('pp-chegando'), 400);
}

function showApproval(P, ev) {
  if (P.aprovacaoAtual) {
    const fila = P.aprovacoesPendentes || (P.aprovacoesPendentes = []);
    if (P.aprovacaoAtual.key !== ev.key && !fila.some(x => x.key === ev.key)) fila.push(ev);
    return;
  }
  const bar = $('.pane-perm', P.el);
  const pedido = { key: ev.key, desde: Date.now() }; P.aprovacaoAtual = pedido;
  pintarPedido(P, bar, ev);
  bar.classList.remove('hidden');
  chegadaDoPedido(bar);
  marcarEspera(P);                    // a aba tem de mudar de cara AGORA, mesmo estando no fundo
  /* "Sempre permitir" (sem moldura, à esquerda) só aparece quando o motor oferece essa resposta
     para ESTE pedido (allowAlways, que o main.js põe no evento). Pedido que não pode ser aprovado
     por uma tecla perdida (semEnter, do Claude) perde o ↩: o Enter não vale para ele. */
  const sempre = $('.pp-sempre', bar);
  if (sempre) sempre.classList.toggle('hidden', ev.allowAlways !== true);
  bar.classList.toggle('pp-sem-enter', ev.semEnter === true);
  const botoes = [$('.pp-yes', bar), $('.pp-no', bar), sempre].filter(Boolean);
  botoes.forEach(b => { b.disabled = false; });
  const done = async (allow, ehSempre = false) => {
    if (P.aprovacaoAtual !== pedido || botoes[0].disabled) return;
    botoes.forEach(b => { b.disabled = true; });
    try {
      const r = await window.api.approve(ehSempre ? { key: ev.key, allow, sempre: true } : { key: ev.key, allow });
      if (r === false || r && (r.error || r.ok === false)) throw new Error(r && r.error || 'A resposta não chegou. Tente novamente.');
      if (P.aprovacaoAtual !== pedido) return;
      P.aprovacaoAtual = null;
      bar.classList.add('hidden'); marcarEspera(P);
      /* o "sempre" do Claude para edição é o modo "Editar automaticamente" desta sessão: o motor já
         trocou sozinho, então aqui só o botão de permissão acompanha (sem desligar o motor) */
      if (ehSempre && ev.sempreModo && (MODOS[P.engine] || []).some(m => m.id === ev.sempreModo)) {
        P.mode = ev.sempreModo; pintarModo(P); savePanes();
      }
      const proximo = (P.aprovacoesPendentes || []).shift();
      if (proximo) showApproval(P, proximo);
    } catch (e) {
      if (P.aprovacaoAtual !== pedido) return;
      botoes.forEach(b => { b.disabled = false; });
      avisoTemp(P, e.message || 'Não consegui enviar sua resposta. Tente novamente.', true);
    }
  };
  $('.pp-yes', bar).onclick = () => done(true);
  $('.pp-no', bar).onclick = () => done(false);
  if (sempre) sempre.onclick = () => done(true, true);
}

/* Teclas do pedido de autorização (tela de atalhos, grupo "Autorização"): ↩ Permitir, ⌥↩ Sempre
   permitir, esc Negar. Só com o cartão à vista no chat em foco. Quem chama garante o resto: o
   Enter só chega aqui com o campo vazio (texto escrito é mensagem, nunca resposta ao pedido) e o
   Esc só depois de fechar o que estiver aberto por cima. Clica o botão de verdade: o que acontece
   depois é o mesmo do clique. Devolve true quando a tecla foi usada. */
function teclaDoPedido(P, e) {
  if (!P || !P.aprovacaoAtual || e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.shiftKey) return false;
  /* No telefone não há teclado (caixa.css, bloco "SÓ NO CELULAR", tira a dica esc / ↩ de lá): a
     tecla sai junto com a dica. Sem isto o "return" do teclado da tela, com o campo vazio,
     permitia o pedido (um "rm -rf" inclusive) sem ninguém tocar no Permitir. Mesma consulta da
     dica (MQ_CELULAR): onde a dica some, a tecla não vale, e vice-versa. */
  if (window.matchMedia && window.matchMedia(MQ_CELULAR).matches) return false;
  const bar = $('.pane-perm', P.el);
  if (!bar || bar.classList.contains('hidden')) return false;
  let bt = null;
  if (e.key === 'Escape' && !e.altKey) bt = $('.pp-no', bar);
  else if (e.key === 'Enter') bt = e.altKey ? $('.pp-sempre', bar) : (bar.classList.contains('pp-sem-enter') ? null : $('.pp-yes', bar));
  if (!bt || bt.disabled || bt.classList.contains('hidden')) return false;
  e.preventDefault();
  bt.click();
  return true;
}

/* O protocolo do Codex entrega escolhas, planos e perguntas separados da resposta. */
function criarControlesCodex(P) {
  // Plano/Executar e um icone na propria barra, junto do + e da /. Velocidade e Contexto
  // moraram numa linha extra em cima da caixa: ninguem olhava, e a linha roubava altura do
  // texto. Agora vivem dentro do cerebro, ao lado de modelo e esforco — que sao a mesma
  // familia de escolha ("como este chat vai pensar").
  const b = $('.p-plano', P.el); if (!b) return;
  /* Redesenho: o botão do plano está em todo chat que TEM plano (README: + / microfone modo de
     envio plano pasta). No Codex ele é o collaborationMode; nos outros é o mesmo modo "Plano" do
     menu de permissão, pelo mesmo caminho do menu (escolherModo). Clicar de novo volta para o
     modo de antes. */
  b.onclick = () => {
    if (P.engine === 'codex') return mudarEscolhasCodex(P, {
      collaborationMode: P.collaborationMode === 'plan' ? 'default' : 'plan' });
    const modos = MODOS[P.engine] || [];
    const plano = modos.find(m => m.id === 'plan');
    if (!plano) return;
    if (modoDe(P).id === 'plan') {
      const antes = modos.find(m => m.id === P.modoAntesDoPlano && m.id !== 'plan') || modos[0];
      return escolherModo(P, antes);
    }
    P.modoAntesDoPlano = modoDe(P).id;
    return escolherModo(P, plano);
  };
}
/* O botão do plano fora do Codex: aparece quando o motor tem o modo "Plano" (Claude, Gemini, ACP;
   o Grok não tem) e fica .ligado com esse modo escolhido. Chamado por pintarControlesCodex e
   pintarModo, que é quem repinta depois de trocar o modo. */
function pintarPlano(P) {
  const b = $('.p-plano', P.el); if (!b || P.engine === 'codex') return;
  const tem = (MODOS[P.engine] || []).some(m => m.id === 'plan');
  b.classList.toggle('hidden', !tem);
  if (!tem) return;
  const plano = modoDe(P).id === 'plan';
  b.innerHTML = ico('clipboard-list');
  b.classList.toggle('ligado', plano);
  b.setAttribute('aria-pressed', String(plano));
  b.disabled = false;
  b.title = plano ? 'Modo Plano: ele só estuda e mostra o plano, não altera nada. Clique para voltar ao modo de antes.'
    : 'Planejar antes de executar: ele só estuda e mostra o plano, sem alterar nada.';
}
/* Velocidade e Contexto por dentro do cerebro, em botoes pequenos lado a lado. Como item de
   lista (um por linha, com explicacao embaixo) eles empurravam o menu para 1200px de rolagem:
   quem abre o cerebro para trocar a velocidade nao achava, porque so via modelo. */
function linhaChips(titulo, dica, opcoes, aoEscolher) {
  const box = document.createElement('div'); box.className = 'mo-chips';
  const h = document.createElement('div'); h.className = 'mo-chips-tit'; h.textContent = titulo;
  if (dica) h.title = dica;
  const linha = document.createElement('div'); linha.className = 'mo-chips-linha';
  for (const o of opcoes) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'mo-chip' + (o.on ? ' on' : ''); b.textContent = o.nome;
    if (o.desc) b.title = o.desc;
    b.onclick = () => { aoEscolher(o); };
    linha.appendChild(b);
  }
  box.append(h, linha);
  if (dica) { const d = document.createElement('div'); d.className = 'mo-chips-dica'; d.textContent = dica; box.appendChild(d); }
  return box;
}
function secoesCodexNoCerebro(P, m, repintar) {
  if (P.engine !== 'codex' || modeloPorCreditos(P.model)) return;
  m.appendChild(elLinha());
  m.appendChild(linhaChips('Velocidade', 'Fast responde mais rápido e gasta mais da sua cota.', [
    { id: '', nome: 'Padrão', desc: 'Mantém a velocidade já configurada no Codex.', on: !(P.serviceTier || '') },
    { id: 'default', nome: 'Normal', desc: 'Velocidade comum. Gasta o normal da sua cota.', on: P.serviceTier === 'default' },
    { id: 'fast', nome: 'Fast', desc: 'Responde mais rápido e gasta mais da sua cota.', on: P.serviceTier === 'fast' },
  ], (o) => { mudarEscolhasCodex(P, { serviceTier: o.id }); repintar && repintar(); }));
  m.appendChild(linhaChips('Memória da conversa', 'Lembrar mais segura conversa longa sem esquecer o começo. Está em teste, gasta mais cota e nem todo modelo aceita.', [
    { nome: 'Padrão', desc: 'Ele lembra do tanto de conversa de sempre.', on: !P.experimentalContext, v: false },
    { nome: 'Lembrar mais', desc: 'Em teste. Só nesta conversa.', on: !!P.experimentalContext, v: true },
  ], (o) => { mudarEscolhasCodex(P, { experimentalContext: o.v }); repintar && repintar(); }));
  const e = P.effectiveSettings;
  const pe = document.createElement('div'); pe.className = 'mo-sub mo-estado';
  pe.textContent = P.settingsPending
    ? 'Escolha nova: entra na próxima mensagem.'
    : e ? 'O Codex já está usando estas escolhas.' : '';
  if (pe.textContent) m.appendChild(pe);
}
function pintarControlesCodex(P) {
  const b = $('.p-plano', P.el); if (!b) return;
  const codex = P.engine === 'codex', paid = modeloPorCreditos(P.model);
  b.classList.toggle('hidden', !codex);
  if (!codex) { pintarPlano(P); return; }
  const plano = P.collaborationMode === 'plan';
  // o desenho é sempre o do "plano" (README); ligado ou não quem diz é o fundo (.ligado)
  b.innerHTML = ico('clipboard-list');
  b.classList.toggle('ligado', plano);
  b.setAttribute('aria-pressed', String(plano));
  b.disabled = paid;
  b.title = paid ? 'Disponível no Codex pelo plano. A API usa controles próprios.'
    : plano ? 'Modo Plano: ele só monta o plano, não mexe em nada. Clique para voltar a executar.'
    : 'Modo Executar: ele faz o trabalho. Clique para ele planejar antes.';
  // o pontinho no cerebro avisa que a escolha ainda nao chegou ao motor
  const cer = $('.p-model', P.el);
  if (cer) {
    cer.classList.toggle('pendente', !!P.settingsPending && codex);
    const e = P.effectiveSettings;
    cer.title = (P.settingsPending ? 'Escolha nova: entra na próxima mensagem.\n' : '')
      + 'Trocar o modelo, o esforço, a velocidade e a memória'
      + (e ? '\n\nEm uso agora: ' + [e.model || '', e.effort ? 'Esforço: ' + (EF_PT[e.effort] || e.effort) : '',
        e.serviceTier ? (['fast', 'priority'].includes(e.serviceTier) ? 'Fast' : 'Normal') : '',
        e.collaborationMode === 'plan' ? 'Modo Plano' : 'Modo Executar',
        e.experimentalContext ? 'Lembrar mais' : ''].filter(Boolean).join(' · ') : '');
  }
}
async function mudarEscolhasCodex(P, patch) {
  Object.assign(P, patch); P.settingsPending = true;
  const revision = P.settingsRevision = (P.settingsRevision || 0) + 1;
  pintarControlesCodex(P); savePanes();
  if (P.started && !P.busy && window.api.paneSettings) {
    try {
      const r = await window.api.paneSettings({ paneId: P.id, engine: P.engine, ...escolhasCodex(P) });
      if (r && (r.ok === false || r.error)) throw new Error(r.error || 'Não foi possível aplicar esta escolha.');
      if (r && r.settings && (P.settingsRevision || 0) === revision) {
        P.settingsPending = !!r.pending;
        aplicarSettingsCodex(P, { ...r.settings, pending: !!r.pending });
      }
    } catch (e) { avisoTemp(P, 'Escolha guardada para a próxima mensagem. ' + (e.message || '')); }
  }
}
function aplicarSettingsCodex(P, ev) {
  const s = ev.settings || ev; P.effectiveSettings = { ...(P.effectiveSettings || {}), ...s };
  if (ev.pending || s.pending) P.settingsPending = true;
  if (P.settingsSend && P.settingsSend.phase === 'sending') P.settingsSend.confirmed = s;
  if (!P.settingsPending && !P.settingsSend) {
    if (s.model && !modeloPorCreditos(P.model)) {
      P.model = s.model;
      if (MODELOS_CODEX && !MODELOS_CODEX.some(m => m.id === s.model)) {
        MODELOS_CODEX.push({ id: s.model, nome: s.model, efforts: [s.effort || 'medium'] });
      }
    }
    if (s.effort) P.effort = s.effort;
    if (s.collaborationMode) P.collaborationMode = typeof s.collaborationMode === 'string' ? s.collaborationMode : s.collaborationMode.mode;
    if (typeof s.experimentalContext === 'boolean') P.experimentalContext = s.experimentalContext;
    if (s.serviceTier) P.serviceTier = ['fast', 'priority'].includes(s.serviceTier) ? 'fast' : 'default';
  }
  fillModels(P); pintarControlesCodex(P); savePanes();
}
function cartaoCodex(P, classe, titulo) {
  clearEmpty(P);
  const el = document.createElement('section'); el.className = 'cx-cartao ' + classe;
  const h = document.createElement('h3'); h.textContent = titulo; el.appendChild(h);
  P.chat.appendChild(el); scroll(P); return el;
}
function planoCodex(P, ev) {
  if (Array.isArray(ev.steps) || Array.isArray(ev.plan)) {
    desenharPlano(P, ev.steps || ev.plan); savePanes(); return;
  }
  const id = ev.turnId || ev.id || 'atual';
  if (!P.codexPlan || !P.codexPlan.el.isConnected || P.codexPlan.id !== id) {
    P.codexPlan = { id, el: cartaoCodex(P, 'cx-plano-cartao', 'Plano de trabalho') };
  }
  const el = P.codexPlan.el; el.replaceChildren();
  const steps = ev.steps || ev.plan || [];
  const feitos = steps.filter(s => ['completed', 'done'].includes(s.status)).length;
  const h = document.createElement('h3'); h.textContent = 'Plano de trabalho' + (steps.length ? ' · ' + feitos + '/' + steps.length : ''); el.appendChild(h);
  if (ev.explanation || ev.text) { const p = document.createElement('p'); p.textContent = ev.explanation || ev.text; el.appendChild(p); }
  const lista = document.createElement('ol'); lista.className = 'cx-passos';
  for (const step of steps) {
    const li = document.createElement('li'); li.dataset.status = step.status || 'pending';
    const pronto = ['completed', 'done'].includes(step.status);
    const status = pronto ? 'Concluído' : ['in_progress', 'inProgress'].includes(step.status) ? 'Em andamento' : 'A fazer';
    const marca = document.createElement('span'); marca.className = 'cx-passo-marca'; marca.textContent = pronto ? '✓' : status === 'Em andamento' ? '●' : '○'; marca.title = status;
    const texto = document.createElement('span'); texto.textContent = step.step || step.text || step.title || String(step);
    li.append(marca, texto); lista.appendChild(li);
  }
  el.appendChild(lista); scroll(P);
}
function estadoCodex(P, chave, titulo, mensagem, encerrado) {
  if (!P.codexEstados) P.codexEstados = new Map();
  let el = P.codexEstados.get(chave);
  if (!el || !el.isConnected) { el = cartaoCodex(P, 'cx-estado', titulo); P.codexEstados.set(chave, el); }
  el.classList.toggle('encerrado', !!encerrado); el.replaceChildren();
  const h = document.createElement('h3'); h.textContent = titulo;
  const p = document.createElement('p'); p.textContent = mensagem || '';
  el.append(h, p); return el;
}
function esperaCodex(P, ev) {
  const terminou = ['done', 'completed', 'cancelled', 'interrupted', 'ended'].includes(ev.status);
  if (terminou && !(P.codexEstados && P.codexEstados.get('espera') && P.codexEstados.get('espera').isConnected)) return;
  let mensagem = ev.message || (terminou ? 'A espera terminou.' : 'O trabalho continua quando a espera terminar.');
  if (ev.until) { const d = new Date(ev.until); if (!Number.isNaN(d.valueOf())) mensagem += ' Até ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.'; }
  estadoCodex(P, 'espera', terminou ? 'Espera encerrada' : 'Aguardando', mensagem, terminou);
}
function metaCodex(P, ev) {
  const goal = ev.goal || ev;
  const status = { active: 'Em andamento', complete: 'Concluída', completed: 'Concluída', blocked: 'Precisa de informação', paused: 'Pausada' }[goal.status] || goal.status || 'Em andamento';
  estadoCodex(P, 'meta', 'Meta · ' + status, goal.objective || goal.objetivo || goal.message || '', ['complete', 'completed'].includes(goal.status));
}
async function imagemGeradaCodex(P, ev) {
  const el = cartaoCodex(P, 'cx-imagem', 'Imagem gerada');
  let src = ev.url || ev.imageUrl || ev.image_url || ev.dataUrl || '';
  const path = ev.path || ev.localPath || ev.filePath;
  const status = document.createElement('p'); status.textContent = 'Abrindo imagem…'; el.appendChild(status);
  try {
    if (path) { const a = await lerParaVisor(caminhoDoPainel(P, path)); if (a && a.tipo === 'imagem') src = a.dados; }
    if (!/^(https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(src)) {
      status.textContent = path ? 'Imagem salva: ' + path.split('/').pop() : 'A imagem não está disponível para prévia.';
    } else {
      const img = document.createElement('img'); img.alt = ev.prompt || 'Imagem gerada pelo Codex'; img.loading = 'lazy'; img.src = src;
      img.onload = () => { status.remove(); scroll(P); };
      img.onerror = () => { img.remove(); status.textContent = 'Não foi possível carregar a prévia.'; };
      el.appendChild(img);
    }
    if (ev.prompt) { const p = document.createElement('p'); p.textContent = ev.prompt; el.appendChild(p); }
    if (path) { const b = document.createElement('button'); b.type = 'button'; b.className = 'cx-acao'; b.textContent = 'Abrir imagem'; b.onclick = () => verArquivo(P, caminhoDoPainel(P, path)); el.appendChild(b); }
  } catch { status.textContent = 'Não foi possível abrir a imagem.'; }
}
function encerrarPerguntaCodex(P, key, texto = 'Resposta enviada.') {
  const q = P.questions && P.questions.get(String(key)); if (!q) return;
  q.done = true; q.el.classList.add('encerrada');
  $$('input, select, textarea, button', q.el).forEach(x => { x.disabled = true; });
  $('.cxq-status', q.el).textContent = texto;
  marcarEspera(P);
}
function campoSchemaCodex(schema, nome, obrigatorio) {
  const wrap = document.createElement('div'); wrap.className = 'cxq-campo';
  const label = document.createElement('label'); label.textContent = schema.title || nome;
  wrap.appendChild(label);
  let input, read;
  const enums = schema.enum || (schema.items && schema.items.enum);
  if (enums) {
    input = document.createElement('select'); input.multiple = schema.type === 'array';
    if (!input.multiple) { const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Escolha uma opção'; input.appendChild(empty); }
    enums.forEach((v, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = (schema.enumNames || schema.enumTitles || [])[i] || String(v); input.appendChild(o); });
    read = () => input.multiple ? [...input.selectedOptions].map(o => enums[Number(o.value)]) : input.value === '' ? undefined : enums[Number(input.value)];
  } else if (schema.type === 'boolean') {
    input = document.createElement('select');
    for (const [v, t] of [['', 'Escolha'], ['true', 'Sim'], ['false', 'Não']]) { const o = document.createElement('option'); o.value = v; o.textContent = t; input.appendChild(o); }
    read = () => input.value === '' ? undefined : input.value === 'true';
  } else if (schema.type === 'object' || schema.type === 'array') {
    input = document.createElement('textarea'); input.placeholder = schema.type === 'array' ? '["item"]' : '{"campo": "valor"}';
    read = () => { if (!input.value.trim()) return undefined;
      const v = JSON.parse(input.value); if (schema.type === 'array' ? !Array.isArray(v) : !v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Confira o formato de ' + nome + '.'); return v; };
  } else {
    input = document.createElement('input'); input.type = ['integer', 'number'].includes(schema.type) ? 'number' : schema.format === 'email' ? 'email' : schema.format === 'uri' ? 'url' : 'text';
    if (input.type === 'number') { input.step = schema.type === 'integer' ? '1' : 'any'; if (schema.minimum != null) input.min = schema.minimum; if (schema.maximum != null) input.max = schema.maximum; }
    if (schema.minLength != null) input.minLength = schema.minLength;
    if (schema.maxLength != null) input.maxLength = schema.maxLength;
    read = () => input.value === '' ? undefined : input.type === 'number' ? Number(input.value) : input.value;
  }
  input.classList.add('cxq-input'); input.required = !!obrigatorio; input.setAttribute('aria-label', schema.title || nome);
  label.appendChild(input);
  if (schema.description) { const d = document.createElement('small'); d.textContent = schema.description; wrap.appendChild(d); }
  return { el: wrap, read };
}
function perguntaCodex(P, ev, historico = false) {
  if (!P.questions) P.questions = new Map();
  const key = String(ev.key ?? ev.id ?? 'historico-' + P.questions.size);
  if (P.questions.has(key) && P.questions.get(key).el.isConnected) return;
  const schema = ev.schema || ev.requestedSchema;
  const tipo = ev.questionKind || ev.requestKind || ev.mode || 'input';
  const perguntas = ev.questions || [];
  /* redesenho 26/09: pergunta ÚNICA vira o próprio título do cartão (em 600, ao lado do glifo
     de espera), como no design; o "Preciso da sua resposta" de cima era uma linha a mais. O
     <legend> continua no fieldset (leitor de tela), só escondido. */
  const soUma = tipo !== 'permissions' && !schema && tipo !== 'elicitation' && perguntas.length === 1
    && !!(perguntas[0].question || perguntas[0].header);
  const titulo = tipo === 'permissions' ? 'Pedido de permissão' : schema || tipo === 'elicitation' ? 'Pergunta do conector'
    : soUma ? (perguntas[0].question || perguntas[0].header) : 'Preciso da sua resposta';
  const el = cartaoCodex(P, 'cx-pergunta', titulo); el.dataset.questionKey = key;
  if (ev.message || ev.title) { const p = document.createElement('p'); p.textContent = ev.message || ev.title; el.appendChild(p); }
  const form = document.createElement('form'); form.className = 'cxq-form';
  const campos = [];
  for (const [index, q] of perguntas.entries()) {
    const fs = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = q.question || q.header || 'Sua resposta'; fs.appendChild(legend);
    if (soUma) legend.className = 'cxq-oculto';
    const group = P.id + '-q-' + index + '-' + Math.random().toString(36).slice(2);
    for (const [n, option] of (q.options || []).entries()) {
      const label = document.createElement('label'); label.className = 'cxq-opcao';
      const radio = document.createElement('input'); radio.type = q.isMultipleChoice ? 'checkbox' : 'radio'; radio.name = group; radio.value = option.label || String(option); radio.id = group + '-' + n;
      const span = document.createElement('span'); span.textContent = option.label || String(option);
      if (option.description) { const small = document.createElement('small'); small.textContent = option.description; span.appendChild(small); }
      label.append(radio, span); fs.appendChild(label);
    }
    const outro = document.createElement(q.isSecret ? 'input' : 'textarea');
    if (q.isSecret) outro.type = 'password';
    outro.className = 'cxq-input'; outro.placeholder = q.options && q.options.length ? 'Outra resposta' : 'Sua resposta'; outro.setAttribute('aria-label', outro.placeholder);
    if (!q.isSecret) outro.rows = 1;   // uma linha de 26, como as opções; cresce enquanto escreve (CSS)
    outro.addEventListener('input', () => { if (outro.value.trim()) $$('input:checked', fs).forEach(x => { x.checked = false; }); });
    fs.addEventListener('change', (e) => { if (e.target.matches('input[type=radio],input[type=checkbox]')) outro.value = ''; });
    fs.appendChild(outro); form.appendChild(fs);
    campos.push({ key: q.id || String(index), read: () => outro.value.trim() ? [outro.value.trim()] : $$('input:checked', fs).map(x => x.value) });
  }
  const props = schema && schema.properties;
  const conteudo = [];
  if (props) for (const [name, value] of Object.entries(props)) {
    const f = campoSchemaCodex(value, name, (schema.required || []).includes(name)); form.appendChild(f.el); conteudo.push({ name, read: f.read });
  }
  const url = ev.url && /^https?:\/\//i.test(ev.url) ? ev.url : null;
  if (url) { const abrir = document.createElement('button'); abrir.type = 'button'; abrir.className = 'cx-acao'; abrir.textContent = 'Abrir conector'; abrir.onclick = () => window.api.openUrl(url); form.appendChild(abrir); }
  if (!perguntas.length && !props && !url && tipo !== 'permissions') {
    const f = campoSchemaCodex({ type: 'string', title: 'Sua resposta' }, 'resposta', true); form.appendChild(f.el); conteudo.push({ name: 'resposta', read: f.read });
  }
  if (tipo === 'permissions' && ev.permissions) { const pre = document.createElement('pre'); pre.textContent = JSON.stringify(ev.permissions, null, 2); form.appendChild(pre); }
  const status = document.createElement('p'); status.className = 'cxq-status'; status.setAttribute('role', 'status');
  const acoes = document.createElement('div'); acoes.className = 'cxq-acoes';
  const enviar = document.createElement('button'); enviar.type = 'submit'; enviar.className = 'cx-acao principal'; enviar.textContent = tipo === 'permissions' ? 'Permitir' : url ? 'Já concluí' : 'Responder';
  // pergunta comum: "Pular" (o nome do design); permissão e conector continuam com "Cancelar"
  const cancelar = document.createElement('button'); cancelar.type = 'button'; cancelar.className = 'cx-acao';
  cancelar.textContent = tipo === 'permissions' || schema || tipo === 'elicitation' || url ? 'Cancelar' : 'Pular';
  acoes.append(enviar, cancelar); form.append(status, acoes); el.appendChild(form);
  const estado = { el, done: false, isBlocking: ev.isBlocking !== false,
    persisteEntreTurnos: tipo === 'async' || tipo === 'elicitation' || ev.isBlocking === false };
  P.questions.set(key, estado);
  marcarEspera(P);                    // pergunta esperando resposta também trava o chat
  const responder = async (action) => {
    if (estado.done || enviar.disabled) return;
    const answers = Object.create(null), content = Object.create(null);
    try {
      if (action === 'accept') {
        if (!form.reportValidity()) return;
        for (const f of campos) { const a = f.read(); if (!a.length) throw new Error('Responda todas as perguntas antes de enviar.'); answers[f.key] = { answers: a }; }
        for (const f of conteudo) { const v = f.read(); if (v !== undefined) content[f.name] = v; }
      }
      enviar.disabled = cancelar.disabled = true; status.textContent = 'Enviando…';
      const r = await window.api.paneRespond({ paneId: P.id, key: ev.key ?? ev.id, action, answers, content });
      if (estado.done) return;
      if (r === false || r && (r.ok === false || r.error)) throw new Error(r && r.error || 'A resposta não chegou. Tente de novo.');
      encerrarPerguntaCodex(P, key, action === 'accept' ? 'Resposta enviada.' : cancelar.textContent === 'Pular' ? 'Pergunta pulada.' : 'Pedido cancelado.');
    } catch (e) { if (estado.done) return; enviar.disabled = cancelar.disabled = false; status.textContent = e.message || 'Não foi possível responder.'; }
  };
  form.onsubmit = e => { e.preventDefault(); responder('accept'); };
  cancelar.onclick = () => responder('cancel');
  if (historico) encerrarPerguntaCodex(P, key, 'Pergunta do histórico.');
  scroll(P);
}
function renderizarHistorico(P, m) {
  const role = m.role || m.kind || m.type;
  if (role === 'user') userMsg(P, m.text || '', m.attachments || m.anexos);
  else if (['bot', 'assistant'].includes(role)) {
    // os mesmos passos da fala ao vivo (textFinal): sem o linkarArquivos, a entrega que
    // aparecia na hora sumia de novo ao reabrir a conversa
    const b = botBlock(P, m.id || 'h' + Math.random()); b.raw = m.text || ''; b.el.innerHTML = marked.parse(b.raw);
    linkarArquivos(P, b.el); marcarLinksWeb(b.el); botoesDeCopia(b); marcarRecibo(b.el);
    P.hist.push({ quem: nomeDoMotor(P.engine), texto: b.raw });
  } else if (role === 'tool') {
    const id = m.id || 'h' + Math.random(); toolStart(P, id, m.name, m.arg, { edicao: m.edicao, tarefas: m.tarefas });
    if (m.output) toolOutput(P, id, typeof m.output === 'string' ? m.output : JSON.stringify(m.output));
    toolEnd(P, id, m.output || '', m.error, m.imagens);
  } else if (role === 'plan') planoCodex(P, m);
  else if (['generated-image', 'image'].includes(role)) imagemGeradaCodex(P, m);
  else if (role === 'agentes') agentesEvento(P, m);
  else if (role === 'question') perguntaCodex(P, m, true);
  else if (role === 'goal') metaCodex(P, m);
  else if (role === 'settings') aplicarSettingsCodex(P, m);
  else if (role === 'waiting') esperaCodex(P, m);
  else if (['compactou', 'compaction'].includes(role)) estadoCodex(P, 'compactacao', 'Conversa resumida', m.text || 'Resumo salvo no histórico.', true);
  else if (role === 'note' && m.text) note(P, m.text, m.error);
}

/* ============ arvore de arquivos ============ */
const expanded = new Set();
let treeGen = 0;
async function loadTree(dir) {
  if (!$('#tree')) return;   // a coluna de arquivos foi tirada da tela
  const gen = ++treeGen;                    // cancela um carregamento anterior ainda em andamento
  $('#projName').textContent = dir === HOME ? 'Pasta: Mac inteiro' : ('Pasta: ' + (dir.split('/').pop() || dir));
  const box = $('#tree'); box.innerHTML = '';
  await level(dir, box, 0, gen);
}
async function level(dir, container, depth, gen) {
  if (gen !== undefined && gen !== treeGen) return;
  const r = await window.api.listDir(dir);
  if (gen !== undefined && gen !== treeGen) return;
  if (r.error) { container.innerHTML = '<div class="hint" style="padding:6px 14px">' + r.error + '</div>'; return; }
  for (const e of r.entries) {
    const n = document.createElement('div');
    n.className = 'node ' + (e.dir ? 'd' : 'f');
    n.style.paddingLeft = (8 + depth * 12) + 'px';
    const open = expanded.has(e.path);
    n.innerHTML = '<span class="chev">' + (e.dir ? (open ? ico('chevron-down') : ico('chevron-right')) : '') + '</span>'
      + '<span class="ico">' + (e.dir ? ico('folder') : icon(e.name)) + '</span><span class="nm"></span>';
    $('.nm', n).textContent = e.name;
    container.appendChild(n);
    if (e.dir) {
      const kids = document.createElement('div'); container.appendChild(kids);
      if (open) await level(e.path, kids, depth + 1, gen);
      n.addEventListener('click', async () => {
        if (expanded.has(e.path)) { expanded.delete(e.path); kids.innerHTML = ''; $('.chev', n).innerHTML = ico('chevron-right'); }
        else { expanded.add(e.path); $('.chev', n).innerHTML = ico('chevron-down'); await level(e.path, kids, depth + 1); }
      });
    } else {
      n.addEventListener('click', () => {
        if (!focusPane) return;
        const inp = $('.p-input', focusPane.el);
        inp.value = (inp.value ? inp.value + ' ' : '') + e.path;
        inp.focus();
      });
      /* Arquivo da VPS nao existe no Finder: o openPath falharia calado (o shell:open nem tem
         guarda de remoto), e era por isso que duplo clique num arquivo da VPS nao fazia NADA.
         Ele abre no visor de dentro do app. O caminho local segue igual ao que sempre foi. */
      n.addEventListener('dblclick', () => {
        if (NA_VPS(e.path) && focusPane) return verArquivo(focusPane, e.path);
        window.api.openPath(e.path);
      });
    }
  }
}
function icon(name) {
  const x = name.split('.').pop().toLowerCase();
  if (['js','mjs','ts','tsx','jsx','py','html','css'].includes(x)) return ico('file-code');
  if (['json','yml','yaml','toml'].includes(x)) return ico('braces');
  if (['md','txt'].includes(x)) return ico('file-text');
  if (['png','jpg','jpeg','gif','svg','webp'].includes(x)) return ico('image');
  if (['sh','zsh','bash'].includes(x)) return ico('terminal');
  return ico('file');
}

/* ============ menus (mesma cara do VSCode, em português) ============ */
const MODOS = {
  claude: [
    /* `curta`: a linha de 11px do menu (redesenho 26/09, uma linha só); `desc` continua sendo o
       balão do mouse e o recado "Modo: …" que aparece depois de trocar */
    { id: 'manual',    ic: 'hand', nome: 'Manual',                 desc: 'Pergunta antes de cada ação' },
    { id: 'auto-edit', ic: 'code-xml', nome: 'Editar automaticamente', desc: 'Mexe nos arquivos sozinho e pergunta o resto', curta: 'Edita arquivos sem perguntar' },
    { id: 'plan',      ic: 'clipboard-list', nome: 'Plano',                  desc: 'Só estuda e mostra o plano, não altera nada', curta: 'Só planeja, não executa' },
    { id: 'auto',      ic: 'zap', nome: 'Auto',                   desc: 'Segue sozinho no que é seguro e para no que é arriscado', curta: 'Pergunta só o que for arriscado' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'Faz tudo sem perguntar, inclusive o que é perigoso', curta: 'Faz tudo sem perguntar' },
  ],
  codex: [
    { id: 'manual',    ic: 'hand', nome: 'Manual',                 desc: 'Pergunta antes de cada ação' },
    { id: 'auto',      ic: 'zap', nome: 'Auto',                   desc: 'Segue sozinho no que é seguro e para no que é arriscado', curta: 'Pergunta só o que for arriscado' },
    /* approvalsReviewer: auto_review no thread/start — um revisor automatico do proprio
       Codex decide os pedidos arriscados, dentro do sandbox da pasta. So do Codex: no
       Claude nao existe modo assim, e o mapa de la cairia em "sem pedir permissao". */
    { id: 'revisado',  ic: 'sparkles', nome: 'Revisado por IA',   desc: 'Um revisor automático aprova ou barra os pedidos arriscados, sem te interromper', curta: 'Um revisor decide o arriscado' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'Faz tudo sem perguntar, inclusive o que é perigoso', curta: 'Faz tudo sem perguntar' },
  ],
  /* leva 12.4 — no ACP o pedido de permissão chega pelo protocolo (session/request_permission)
     e vira o MESMO cartão Permitir/Negar. Os modos são traduzidos para o vocabulário de cada
     agente (default/autoEdit/plan/yolo no Gemini) quando ele os tem; "sem pedir permissão"
     vale sempre, porque quem aprova ali é o próprio Cockpit. */
  acp: [
    { id: 'manual',    ic: 'hand', nome: 'Manual',                 desc: 'O agente pergunta antes de cada ação', curta: 'Pergunta antes de cada ação' },
    { id: 'auto-edit', ic: 'code-xml', nome: 'Editar automaticamente', desc: 'Mexe nos arquivos sozinho e pergunta o resto (se o agente tiver esse modo)', curta: 'Edita arquivos sem perguntar' },
    { id: 'plan',      ic: 'clipboard-list', nome: 'Plano',                  desc: 'Só estuda e mostra o plano (se o agente tiver esse modo)', curta: 'Só planeja, não executa' },
    { id: 'bypass',    ic: 'unlock', nome: 'Sem pedir permissão',    desc: 'O Cockpit aprova todo pedido do agente sozinho', curta: 'Faz tudo sem perguntar' },
  ],
};
/* redesenho 26/09: `curta` também no ACP e no Gemini. Sem ela, o menu mostrava a explicação
   inteira cortada no meio ("Ferramentas que exigem confirmação são rec…") */
MODOS.gemini = [
  { id: 'manual', ic: 'hand', nome: 'Manual', desc: 'Ferramentas que exigem confirmação são recusadas. Para aprovar na tela, use Gemini pelo ACP.', curta: 'Recusa o que pede confirmação' },
  { id: 'auto', ic: 'code-xml', nome: 'Editar automaticamente', desc: 'Permite editar arquivos; outras ações seguem as regras do Gemini', curta: 'Edita arquivos sem perguntar' },
  { id: 'plan', ic: 'clipboard-list', nome: 'Plano', desc: 'Pede o modo de planejamento do Gemini', curta: 'Só planeja, não executa' },
  { id: 'bypass', ic: 'unlock', nome: 'Sem pedir permissão', desc: 'Libera as ferramentas do Gemini automaticamente', curta: 'Faz tudo sem perguntar' },
];
MODOS.grok = [MODOS.acp[0], MODOS.acp[3]];
const esforcoDe = (P) => P.effort;
/* Plano no Codex é collaborationMode, separado da permissão. A troca de motor preserva
   essa intenção; aqui a permissão equivalente continua Manual, nunca a opção mais solta. */
const MODO_EQUIVALENTE = { 'auto-edit': 'auto', plan: 'manual' };
const modoDe = (P) => {
  const lista = MODOS[P.engine] || MODOS.claude;
  return lista.find(m => m.id === P.mode)
      || lista.find(m => m.id === MODO_EQUIVALENTE[P.mode])
      || lista.find(m => m.id === 'manual')
      || lista[0];
};

/* ---- barra de esforço: trilho contínuo, arrasta com ímã e volta no encaixe ---- */
const clamp01 = (v, a, b) => Math.min(b, Math.max(a, v));
const suave = (a, b, v) => { const x = clamp01((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const entre = (a, b, t) => a + (b - a) * t;

function barraEsforco(P) {
  const lista = esforcosDe(P);
  const ULT = lista.length - 1;

  const box = document.createElement('div');
  box.className = 'ef-blk';
  box.innerHTML =
    '<div class="ef-top">' +
      '<div class="ef-tit">Esforço <span class="ef-stage">' +
        '<span class="ef-out"></span><span class="ef-cur"></span></span></div>' +
      '<div class="ef-helpwrap"><button class="ef-help" type="button" aria-label="o que é isso">' +
        ico('circle-help') + '</button>' +
        '<div class="ef-tip">Quanto mais alto, mais tempo ele pensa antes de responder. O último nível gasta a sua cota bem mais rápido.</div>' +
      '</div>' +
    '</div>' +
    '<div class="ef-axis"><span>Mais rápido</span><span>Mais esperto</span></div>' +
    '<div class="ef-shell">' +
      '<div class="ef-track"><div class="ef-fill"></div><canvas class="ef-px"></canvas>' +
      '<div class="ef-ticks">' + lista.map(() => '<span class="ef-tick"></span>').join('') + '</div></div>' +
      '<div class="ef-thumb" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="' + ULT + '"></div>' +
    '</div>';

  const shell = $('.ef-shell', box), thumb = $('.ef-thumb', box);
  const cur = $('.ef-cur', box), out = $('.ef-out', box);
  // redesenho 26/09: o "?" com a explicação saiu da tela (nenhuma frase explicativa); ela fica no
  // balão do mouse da linha "Esforço"
  $('.ef-top', box).title = $('.ef-tip', box).textContent;
  const track = $('.ef-track', box), cv = $('.ef-px', box);

  let valor = Math.max(0, lista.findIndex(e => e.id === P.effort));
  let ix = Math.round(valor);
  // aplicando trava reentrancia: segurar a seta do teclado dispara keydown em fila, e sem
  // essa trava cada tecla abria seu proprio confirm() de "vai perder o trabalho" (R3-035)
  let arrastando = false, aplicando = false, amostras = [], frameMola = 0, framePx = 0, revelar = 0, ultraDesde = 0;

  const nome = (i) => EF_PT[lista[i].id] || lista[i].id;

  function trocaRotulo(novoTxt, pFrente) {
    const antes = cur.textContent;
    if (!antes) { cur.textContent = novoTxt; return; }
    out.textContent = antes; cur.textContent = novoTxt;
    cur.style.setProperty('--sobe', pFrente ? '3px' : '-3px');
    out.style.setProperty('--sai', pFrente ? '-3px' : '3px');
    cur.classList.add('preparando'); out.classList.remove('saindo');
    void cur.getBoundingClientRect();
    requestAnimationFrame(() => { cur.classList.remove('preparando'); out.classList.add('saindo'); });
    setTimeout(() => { out.textContent = ''; out.classList.remove('saindo'); }, 210);
  }

  function pintar(v) {
    valor = clamp01(v, 0, ULT);
    box.style.setProperty('--ef-prog', String(ULT ? valor / ULT : 0));
    const novoIx = Math.round(valor);
    if (novoIx !== ix) { const frente = novoIx > ix; ix = novoIx; trocaRotulo(nome(ix), frente); }
    else if (!cur.textContent) cur.textContent = nome(ix);
    box.classList.toggle('ultra', ix === ULT);
    thumb.title = nome(ix) + (lista[ix].desc ? ' — ' + lista[ix].desc : '');
    thumb.setAttribute('aria-valuenow', String(ix));
    thumb.setAttribute('aria-valuetext', nome(ix));
  }

  // ímã: perto de um encaixe, puxa para ele
  function ima(v) {
    const perto = Math.round(v), d = v - perto, dist = Math.abs(d);
    if (dist < 0.001 || dist > 0.5) return v;
    const t = 1 - dist / 0.5;
    return v - d * (0.68 + 0.42 * t) * t * t;
  }

  function encaixar() {
    const alvo = Math.round(valor);
    if (Math.abs(alvo - valor) < 0.001) { aplicar(alvo); return; }
    let vel = 0;
    if (amostras.length >= 2) {
      const a = amostras[0], b = amostras[amostras.length - 1];
      vel = clamp01((b.v - a.v) / Math.max((b.t - a.t) / 1000, 0.016), -8, 8);
    }
    cancelAnimationFrame(frameMola);
    let pos = valor, tAnt = performance.now();
    const passo = (t) => {
      const dt = Math.min((t - tAnt) / 1000, 0.032); tAnt = t;
      vel += (-920 * (pos - alvo) - 40 * vel) * dt;
      pos = clamp01(pos + vel * dt, 0, ULT);
      pintar(pos);
      if (Math.abs(pos - alvo) < 0.001 && Math.abs(vel) < 0.01) { frameMola = 0; aplicar(alvo); return; }
      frameMola = requestAnimationFrame(passo);
    };
    frameMola = requestAnimationFrame(passo);
  }

  async function aplicar(i) {
    // trava de reentrancia: teclado em repeticao ou 2 chamadas em fila nao empilham confirm() (R3-035)
    if (aplicando) return;
    aplicando = true;
    try {
      const antes = ix;
      pintar(i);
      // cancelou (trabalho rodando e ele desistiu): o slider não pode mentir sobre o esforço atual
      if (await trocarEsforco(P, lista[i].id) === false) pintar(antes);
    } finally {
      aplicando = false;
    }
  }

  const valorDoX = (clientX) => {
    const r = shell.getBoundingClientRect();
    const larg = 22;                                   // largura do puxador
    const util = Math.max(1, r.width - larg);
    return clamp01(((clientX - r.left - larg / 2) / util) * ULT, 0, ULT);
  };
  // Pointer Events cobrem mouse e toque com a mesma API (R1-021: no iPhone o
  // arrasto de dedo não gerava mousemove e a tela só rolava).
  const comecar = (e) => {
    // um dedo por vez: no iPhone um segundo toque durante o arrasto resetava `amostras` e
    // os dois dedos brigavam pelo mesmo valor/ix do slider (R2-045)
    if (arrastando) return;
    e.preventDefault(); e.stopPropagation();
    cancelAnimationFrame(frameMola);
    arrastando = true; box.classList.add('pegando');
    // mantém o arrasto recebendo eventos mesmo se o dedo/cursor sair da régua
    if (shell.setPointerCapture) shell.setPointerCapture(e.pointerId);
    amostras = [{ t: performance.now(), v: valor }];
    pintar(ima(valorDoX(e.clientX)));
    const mover = (ev) => {
      const v = ima(valorDoX(ev.clientX));
      const agora = performance.now();
      amostras.push({ t: agora, v });
      amostras = amostras.filter(a => agora - a.t < 90).slice(-5);
      pintar(v);
    };
    const soltar = (ev) => {
      shell.removeEventListener('pointermove', mover);
      shell.removeEventListener('pointerup', soltar);
      shell.removeEventListener('pointercancel', soltar);
      if (shell.releasePointerCapture && ev && ev.pointerId != null) {
        try { shell.releasePointerCapture(ev.pointerId); } catch {}
      }
      arrastando = false; box.classList.remove('pegando');
      encaixar();
    };
    shell.addEventListener('pointermove', mover);
    shell.addEventListener('pointerup', soltar);
    shell.addEventListener('pointercancel', soltar);
  };
  shell.addEventListener('pointerdown', comecar);
  thumb.addEventListener('keydown', (e) => {
    const alvos = { ArrowLeft: ix - 1, ArrowDown: ix - 1, ArrowRight: ix + 1, ArrowUp: ix + 1, Home: 0, End: ULT };
    if (!(e.key in alvos)) return;
    e.preventDefault(); aplicar(clamp01(alvos[e.key], 0, ULT));
  });
  box.addEventListener('mousedown', e => e.stopPropagation());
  $('.ef-help', box).addEventListener('click', (e) => { e.stopPropagation(); $('.ef-helpwrap', box).classList.toggle('aberto'); });

  /* ---- campo de pixels do último nível, na cor do painel ---- */
  let accent = [110, 168, 254];
  function lerAccent() {
    const c = getComputedStyle(P.el).getPropertyValue('--accent').trim();
    const m = c.match(/#([0-9a-f]{6})/i);
    if (m) accent = [parseInt(m[1].slice(0,2),16), parseInt(m[1].slice(2,4),16), parseInt(m[1].slice(4,6),16)];
  }
  function limparPixels() {
    const ctx = cv.getContext('2d'); if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  }
  function medirCanvas() {
    const r = track.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
    return true;
  }
  function desenhar(t) {
    const ctx = cv.getContext('2d'); if (!ctx || !cv.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = cv.width / dpr, A = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, L, A);
    const nivel = ULT ? valor / ULT : 0;          // 0 = apagado, 1 = no talo
    if (nivel <= 0.001) return;
    const forcaNivel = Math.pow(nivel, 0.85);
    const frente = 1 - revelar;
    const cel = L < 240 ? 4 : 5, vao = 1;
    const cols = Math.ceil(L / cel), lins = Math.ceil(A / cel);
    const passado = Math.max(0, t - ultraDesde);
    const fluxoBruto = passado / 4000;
    const fluxo = Math.floor(fluxoBruto) + suave(0, 1, fluxoBruto - Math.floor(fluxoBruto));
    const frio = [58, 58, 62];
    const quente = [Math.min(255, accent[0] + 60), Math.min(255, accent[1] + 60), Math.min(255, accent[2] + 60)];

    ctx.save(); ctx.beginPath(); ctx.roundRect(0, 0, L, A, 8); ctx.clip();
    for (let li = 0; li < lins; li++) {
      for (let co = 0; co < cols; co++) {
        const x = co * cel, y = li * cel;
        const nx = (x + cel / 2) / L;
        // acende so ate onde o puxador chegou, com a beirada suave
        const ateAqui = 1 - suave(nivel - 0.07, nivel + 0.03, nx);
        if (ateAqui <= 0.002) continue;
        const alfa = suave(frente - 0.1, frente + 0.07, nx) * ateAqui;
        if (alfa <= 0.002) continue;
        const quanto = suave(0.1, 0.9, nx / Math.max(nivel, 0.15));
        const forca = suave(0.04, 0.4, nx / Math.max(nivel, 0.15)) * forcaNivel;
        const h1 = Math.abs(Math.sin(co * 12.9898 + li * 78.233) * 43758.5453) % 1;
        const h2 = Math.abs(Math.sin(co * 7.13 + li * 19.41) * 19341.731) % 1;
        const h3 = Math.abs(Math.sin(co * 31.17 + li * 11.93) * 28437.123) % 1;
        const periodo = 500 + h2 * 1500;
        const tl = passado + h3 * periodo;
        const ciclo = Math.floor(tl / periodo), prog = (tl % periodo) / periodo;
        const hc = Math.abs(Math.sin(co * 17.17 + li * 41.73 + ciclo * 13.11) * 24634.6345) % 1;
        const hl = Math.abs(Math.sin(co * 5.37 + li * 29.11 + ciclo * 7.43) * 17391.443) % 1;
        const centro = 0.2 + hc * 0.55, larg = 0.09 + hl * 0.08;
        const d = (prog - centro) / larg;
        const pulso = Math.exp(-d * d * 1.45) * (hc > 0.12 ? 1 : 0.26);
        const fase = (nx + fluxo + li * 0.06 + h1 * 0.02) * Math.PI * 2;
        const onda = Math.pow(0.5 + 0.5 * Math.cos(fase), 5);
        const brilho = Math.max(pulso * (0.48 + onda * 0.58), onda * (0.38 + h1 * 0.28));
        const base = [entre(frio[0], accent[0], quanto), entre(frio[1], accent[1], quanto), entre(frio[2], accent[2], quanto)];
        const mistura = clamp01(brilho * (0.5 + hc * 0.35), 0, 1);
        ctx.globalAlpha = alfa * forca * clamp01(0.62 + brilho * 0.3, 0, 1);
        ctx.fillStyle = 'rgb(' + Math.round(entre(base[0], quente[0], mistura)) + ' '
          + Math.round(entre(base[1], quente[1], mistura)) + ' '
          + Math.round(entre(base[2], quente[2], mistura)) + ')';
        ctx.fillRect(x + vao / 2, y + vao / 2, cel - vao, cel - vao);
      }
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  let ultimoQuadro = 0;
  function loopPixels() {
    if (framePx) return;
    lerAccent();
    if (!medirCanvas()) { setTimeout(loopPixels, 60); return; }
    const passo = (t) => {
      if (!box.isConnected) { framePx = 0; return; }
      if (t - ultimoQuadro >= 33) {
        ultimoQuadro = t;
        revelar = suave(0, 1, (t - ultraDesde) / 900);
        desenhar(t);
      }
      framePx = requestAnimationFrame(passo);
    };
    framePx = requestAnimationFrame(passo);
  }

  pintar(valor);
  cur.textContent = nome(ix);
  ultraDesde = performance.now();
  setTimeout(loopPixels, 30);
  return box;
}

async function trocarEsforco(P, id) {
  // trocar de esforço desliga o motor: com trabalho rodando, pergunta antes (igual ao modo/motor)
  const estavaRodando = !!P.busy || agTrabalhando(P);
  // Codex por mudarEscolhasCodex nunca derruba o turno (aplica ao vivo ou fica pendente pra
  // proxima mensagem); so o Claude em curso e destruido aqui — o aviso so pode mentir pro Codex (R3-006)
  const destroi = P.engine === 'claude' && P.started;
  if (destroi && !confirmarCorte(P, 'Trocar de esforço')) return false;
  // vale só para este painel: conversa nova continua nascendo no esforço de PADRAO_NOVO
  P.effort = id; P.ultraAvisado = false;
  lembrarEscolhaDaPasta(P);
  if (P.engine === 'claude' && P.started) {
    await desligarMotor(P);
    avisoTemp(P, 'Esforço: ' + (EF_PT[id] || id) + '.'
      + (estavaRodando ? ' O que estava em andamento parou aqui.' : ''));
  }
  if (P.engine === 'codex' && !modeloPorCreditos(P.model)) await mudarEscolhasCodex(P, { effort: id });
  savePanes();
  return true;
}

/* recado curto na conversa (some em 9s). "Nenhuma frase explicativa na tela": o recado diz o
   que aconteceu em poucas palavras e o porquê/como vai na dica, no title */
function avisoEnvio(P, txt, dica) {
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'envio-nota';
  d.textContent = txt;
  if (dica) d.title = dica;
  P.chat.appendChild(d);
  if (P.execEl) P.chat.appendChild(P.execEl);
  if (P.trabEl) P.chat.appendChild(P.trabEl);
  scroll(P, true);
  setTimeout(() => d.remove(), 9000);
  return d;
}

function subirNaLista(P) {
  const id = P.sessaoId || P.resumeId;
  const lista = histCache[P.engine];
  if (!id || !lista) return;
  const i = lista.findIndex(s => s.id === id);
  if (i < 0) return;
  lista[i].when = Date.now();
  lista.unshift(lista.splice(i, 1)[0]);
  if (lateralAberta()) pintarConversas();
}

function pintarNome(P) {
  const barra = $('.pane-nome', P.el);
  const t = (P.titulo || '').trim();
  barra.classList.toggle('vazio', !t);
  $('.pn-txt', barra).textContent = t;
  barra.title = t;
  const A = abaDe(P); if (A) pintarAba(A);
}

function renomearAqui(P) {
  const barra = $('.pane-nome', P.el);
  if ($('.pn-input', barra)) return;
  const txt = $('.pn-txt', barra), lapis = $('.pn-edit', barra);
  const inp = document.createElement('input');
  inp.className = 'pn-input';
  inp.value = P.titulo || '';
  txt.style.display = 'none'; lapis.style.display = 'none';
  barra.insertBefore(inp, txt);
  inp.focus(); inp.select();
  let pronto = false;
  const fim = async (salvar) => {
    if (pronto) return; pronto = true;
    const novo = inp.value.trim();
    inp.remove(); txt.style.display = ''; lapis.style.display = '';
    if (salvar && novo && novo !== P.titulo) {
      P.titulo = novo; P.nomeManual = true; pintarNome(P); savePanes();
      const id = P.sessaoId || P.resumeId;
      if (id) { await window.api.renomear({ engine: P.engine, id, nome: novo, origem: 'manual' });
        lembrarNomeDaParte({ engine: P.engine, id, file: P.sessaoFile }, novo);   // o título da cadeia acompanha na hora
        if (lateralAberta()) loadHist(P.engine, true); }
    }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fim(true); }
    if (e.key === 'Escape') { e.stopPropagation(); fim(false); }
  });
  inp.addEventListener('blur', () => fim(true));
}

function mensagensDele(P) {
  return (P.hist || []).filter(h => h.quem === 'Você' && h.texto).map(h => String(h.texto));
}
/* ---- nome da conversa ----
   O nome provisorio (comeco da frase) aparece na hora e a IA ja troca por um titulo da DEMANDA
   so com a 1a mensagem. Depois ela rele a conversa no FIM dos turnos 1, 2, 4, 7 e 12 (e dali em
   diante a cada 10). No fim, e nao no envio como antes, para ver tambem a resposta do assistente:
   "como eles fizeram?" so vira "Trend do COLORS Fake" depois que ele abriu o link. Com a conversa
   mudando de rumo, o nome acompanha o trabalho principal; a IA recebe o nome atual e o repete se
   ele ainda vale, para o nome nao ficar pulando a cada rodada.
   A instrucao e a validacao moram no nomes-conversa.js (lado do main). */
const MARCOS_NOME = [1, 2, 4, 7, 12];
function proximoMarcoNome(feito) {
  for (const m of MARCOS_NOME) if (m > feito) return m;
  let m = 22; while (m <= feito) m += 10;
  return m;
}
/* O material: as mensagens dele (a 1a e as 9 mais recentes) e a PRIMEIRA e a ULTIMA resposta do
   assistente (medido com 25 conversas reais: com as duas ultimas, um pedido lateral do fim, tipo
   "reativa meu login", roubava o nome de uma conversa inteira sobre outra coisa). Sem a pasta:
   com ela a IA chamava tudo de "Adsure". */
function materialDoNome(P) {
  const dele = mensagensDele(P).map(t => t.slice(0, 3000));
  const bots = (P.hist || []).filter(h => h.quem !== 'Você' && h.texto).map(h => String(h.texto).slice(0, 4000));
  return {
    mensagens: dele.length > 10 ? [dele[0], ...dele.slice(-9)] : dele,
    // quantas ele mandou na conversa inteira: sem isto a IA via 10 mensagens numeradas de 1 a 10 e
    // achava a conversa curta ("2 mensagens puladas" quando foram 20)
    total: dele.length,
    respostas: bots.length > 2 ? [bots[0], bots[bots.length - 1]] : bots,
    atual: P.nomeCurto ? P.titulo : '',
  };
}
/* Quem e dono do nome: a conversa marcada em P.nomeDono, que e o PROPRIO P.hist. Toda troca de
   conversa no painel (nova, aberta da lista, outra pasta) cria um P.hist novo, entao a resposta
   atrasada da conversa anterior nunca cai na nova. Conversa que ja existia (aberta da lista, aba que
   voltou ao reabrir o app) ganha o dono pelo nomes.json (assumirNome): nome dado por ele fica
   intocado; nome da IA, novo ou do formato antigo, volta a ser acompanhado. Nome que ele trocou a mao
   (nomeManual) nunca e mexido.
   Uma chamada por vez por chat: pedido que chega com outra no ar espera e sai uma vez so, quando
   ela voltar — com o material mais novo. Se a IA falhar ou devolver lixo, fica o nome que estava;
   se ainda nao ha nome da IA, entra o titulo do proprio Claude como reserva (buscarNome). */
async function nomearCurto(P, comeco) {
  // 1a mensagem de conversa sem nome: nome vazio nunca e nome dado por ele
  if (comeco === 'comeco') {
    P.nomeManual = false; P.nomeCurto = false; P.nomeDono = P.hist; P.nomeMarco = 0; P.nomePendente = ''; P.nomeSemResposta = false;
  }
  if (P.nomeManual || P.nomeDono !== P.hist || !window.api.nomeCurto || !mensagensDele(P).length) return;
  if (P.nomeando) { P.nomeDeNovo = true; return; }
  P.nomeando = true;
  const hist = P.hist;
  const material = materialDoNome(P);
  let nome = '';
  try { nome = await window.api.nomeCurto(material); } catch {}
  P.nomeando = false;
  if (!P.nomeManual && P.hist === hist && P.nomeDono === hist) {
    if (nome) {
      if (trocarNome(P, nome)) { P.titulo = nome; pintarNome(P); savePanes(); }
      P.nomeCurto = true;
      // nome que so viu a 1a mensagem: o 1o fim de turno (que ja ve a resposta) pode trocar direto.
      // Depois que a IA viu uma resposta (trocando ou nao), troca so com a confirmacao do trocarNome.
      if (material.respostas.length) P.nomeSemResposta = false;
      else if (P.titulo === nome) P.nomeSemResposta = true;
      salvarNomeCurto(P);
    } else if (!P.nomeCurto) buscarNome(P);
  }
  if (P.nomeDeNovo) { P.nomeDeNovo = false; nomearCurto(P); }
}
/* O nome nao pode ficar pulando: e por ele que ele acha a conversa na lista. Medido em 25/09 dentro
   do app, a mesma conversa trocou 4 vezes em 5 mensagens ("Video de IA do Instagram" → "Trend de
   Video Fake COLORS" → "Video IA Estilo COLORS" → "Video IA com Voces Cantando"), e um pedido lateral
   do fim tomava o nome ("Transferencia de Videos para SSD"). Regras, na ordem:
   - a IA disse MANTER (o main devolve o nome atual) ou repetiu: fica;
   - ainda nao ha nome da IA (frase provisoria, titulo do Claude, nome do formato antigo): troca;
   - o nome novo diz o mesmo assunto com outras palavras (mesmoAssunto): fica;
   - o nome de agora so tinha visto a 1a mensagem: troca (e a 1a vez que a IA ve a resposta);
   - assunto novo: so troca se o marco SEGUINTE confirmar o mesmo assunto novo. Pedido lateral
     aparece uma vez e some; trabalho que mudou de verdade aparece de novo. */
function trocarNome(P, nome) {
  if (nome === P.titulo) { P.nomePendente = ''; return false; }
  if (!P.nomeCurto) return true;
  if (mesmoAssunto(nome, P.titulo)) { P.nomePendente = ''; return false; }
  if (P.nomeSemResposta) return true;
  if (P.nomePendente && mesmoAssunto(nome, P.nomePendente)) { P.nomePendente = ''; return true; }
  P.nomePendente = nome;
  return false;
}
/* Dois nomes dizem o mesmo assunto quando metade das palavras de verdade do menor esta no outro (sem
   acento, sem preposicao, sem o plural): "Video IA Estilo COLORS" e "Trend de Video Fake COLORS" sim;
   "Video de IA do Instagram" e "Transferencia de Videos para SSD" nao. */
const PALAVRA_DE_LIGACAO = new Set(['de', 'do', 'da', 'dos', 'das', 'com', 'para', 'pra', 'pro', 'no', 'na', 'nos', 'nas',
  'em', 'e', 'a', 'o', 'as', 'os', 'ao', 'aos', 'por', 'sem', 'um', 'uma']);
function palavrasDoNome(t) {
  return new Set(String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(p => p && !PALAVRA_DE_LIGACAO.has(p)).map(p => p.length > 3 ? p.replace(/s$/, '') : p));
}
function mesmoAssunto(a, b) {
  const A = palavrasDoNome(a), B = palavrasDoNome(b);
  if (!A.size || !B.size) return false;
  let comum = 0;
  for (const p of A) if (B.has(p)) comum++;
  return comum / Math.min(A.size, B.size) >= 0.5;
}
/* Fim do turno: passou de um marco desde a ultima olhada? Conta as mensagens dele, e nao os
   turnos, porque mensagem que esperou na fila junta dois pedidos num turno so; "passou de" (e nao
   "e igual a") pelo mesmo motivo: de 3 para 5 mensagens tambem cruzou o marco 4. */
function nomearNoFimDoTurno(P) {
  if (P.nomeManual || P.nomeDono !== P.hist) return;
  const n = mensagensDele(P).length;
  if (n < proximoMarcoNome(P.nomeMarco || 0)) return;
  P.nomeMarco = n;
  nomearCurto(P);
}
/* Conversa que ja existia: o dono do nome vem do nomes.json (donoDoNome no nomes-conversa.js).
   'ia' e nome novo da IA: vai como "atual" e a contagem dos marcos segue de onde a conversa esta.
   'antigo' e o nome do formato velho ("Criacao Dupla"): a IA troca no fim do proximo turno, sem
   receber o nome velho como "atual" (senao ela o repetia). 'manual' e dele: nunca e mexido. */
function assumirNome(P, dono) {
  if (P.nomeManual || P.nomeDono === P.hist) return;
  if (dono === 'manual') { P.nomeManual = true; return; }
  if (dono !== 'ia' && dono !== 'antigo') return;
  P.nomeDono = P.hist; P.nomePendente = ''; P.nomeSemResposta = false;
  P.nomeCurto = dono === 'ia';
  P.nomeMarco = dono === 'ia' ? mensagensDele(P).length : 0;
}
async function lembrarDonoDoNome(P, id, titulo, revisao) {
  if (!id || !titulo || !window.api.donoNome) return;
  let dono = '';
  try { dono = await window.api.donoNome({ id, titulo }); } catch { return; }
  // outra conversa no painel, ou o nome mudou enquanto perguntava: nao mexe
  if (!painelAindaAtual(P, revisao) || P.titulo !== titulo) return;
  assumirNome(P, dono);
  savePanes();
}
/* Grava no nomes.json para a lista lateral e a reabertura mostrarem o mesmo nome, marcado como da
   IA ('auto'). Na 1a mensagem o id da conversa ainda nao existe: o fim do turno chama de novo.
   Com a lateral aberta, redesenha a lista quando a gravacao termina: o nome chega uns 3 s depois
   do fim do turno, e a lista (relida no fim do turno) ficava com o nome da rodada anterior. */
function salvarNomeCurto(P) {
  const id = P.sessaoId || P.resumeId;
  if (!P.nomeCurto || P.nomeManual || !id || P.nomeCurtoSalvo === id + '|' + P.titulo) return;
  P.nomeCurtoSalvo = id + '|' + P.titulo;
  const engine = P.engine;
  Promise.resolve(window.api.renomear({ engine, id, nome: P.titulo, origem: 'auto' }))
    .then(() => { if (lateralAberta()) loadHist(engine, true); }).catch(() => {});
  /* 25/09: numa conversa costurada o titulo da lista sai do nome salvo das partes (NOMES_LIGADOS),
     que so era lido ao abrir a lateral. Sem avisar aqui, o chat trocava para "Criação de Vídeo
     com IA" e a lista continuava no nome velho da parte de antes da troca. */
  lembrarNomeDaParte({ engine, id, file: P.sessaoFile || '' }, P.titulo);
}

/* O titulo do proprio Claude e a RESERVA: vale enquanto a IA do Cockpit nao deu um nome valido (ela
   falhou, passou do prazo ou a 1a mensagem era so um print). Sem a reserva, a conversa ficava para
   sempre com a frase provisoria na barra e com outro nome na lista. Com a IA pensando, espera ela. */
async function buscarNome(P) {
  if (P.engine !== 'claude' || !P.sessaoId || P.nomeManual || P.nomeCurto || P.nomeando) return;
  /* 25/09: chat que veio de uma troca de IA: o titulo que o Claude inventa para a parte NOVA
     nasce do contexto colado ("Estou continuando uma conversa…"). O nome da conversa e o que
     atravessou a troca, e ele vale para a cadeia inteira. */
  if (P.parteAnterior || (Array.isArray(P.partesAnteriores) && P.partesAnteriores.length)) return;
  const hist = P.hist;
  let t = '';
  try { t = await window.api.sessionTitulo({ engine: 'claude', file: P.sessaoFile, id: P.sessaoId }); } catch { return; }
  // a IA respondeu (ou ele renomeou, ou trocou de conversa) enquanto o titulo era lido: fica o dela
  if (P.nomeManual || P.nomeCurto || P.nomeando || P.hist !== hist) return;
  if (t && t !== P.titulo) { P.titulo = t; pintarNome(P); savePanes(); }
}

function pintarModo(P) {
  // NAO grava o resultado de volta em P.mode. Gravando, um chat do Claude no modo "Plano"
  // que passasse pelo Codex (que nao tem Plano) perdia a escolha para sempre: voltava para o
  // Claude em "Manual". Agora P.mode guarda o que ELE escolheu, e o equivalente do motor
  // atual e usado so na hora de pintar e de subir o motor.
  const m = modoDe(P);
  /* Na barra da caixa o redesenho usa só o cadeado: aberto = segue sem perguntar (Auto e Sem
     pedir permissão), fechado = pede antes. O ícone próprio de cada modo continua no menu. */
  $('.modo-ic', P.el).innerHTML = ico(m.id === 'bypass' || m.id === 'auto' ? 'lock-open' : 'lock');
  $('.modo-nome', P.el).textContent = m.nome;
  pintarPlano(P);   // o botão do plano (fora do Codex) é este mesmo modo
}

function fecharMenus() {
  for (const P of panes.values()) {
    const m = $('.p-modal', P.el);
    if (m && m.classList.contains('como-menu')) {
      // redesenho 26/09: o menu some em 120ms. Quem esmaece é uma cópia solta (menuSaindo):
      // o menu de verdade fecha NA HORA, como sempre, e nenhuma conferência de "está aberto?" muda
      if (!m.classList.contains('hidden')) menuSaindo($('.modal-cx', m), P.el);
      m.classList.add('hidden'); m.classList.remove('como-menu'); $('.modal-cx', m).innerHTML = '';
    }
    // menu fechado: o botão que o abriu deixa de ficar marcado (fora do if de propósito: se
    // algum caminho tirou o como-menu sem passar por aqui, a marca sai no próximo clique)
    soltarDonoMenu(P);
    // menu fechado nao pode deixar o atalho de setas do "@" preso ao campo: preso, ele engole
    // o Enter e a mensagem nunca sai
    soltarNavArquivos(P);
  }
}
document.addEventListener('click', fecharMenus);

// link de site sempre abre no navegador do Mac, nunca dentro do app
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (a.classList.contains('arquivo') || href.startsWith('#')) return;
  e.preventDefault(); e.stopPropagation();
  if (/^https?:\/\//i.test(href)) window.api.abrirLink(href);
  else if (href.startsWith('file://')) window.api.abrirLink(decodeURIComponent(href.replace('file://', '')));
  else if (href.startsWith('/')) window.api.abrirLink(href);
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // dentro do terminal embutido, Esc é do terminal, não fecha a janelinha
  const dentroTerm = document.activeElement && document.activeElement.closest && document.activeElement.closest('.term-wrap');
  if (dentroTerm) return;
  // a lista de atalhos fica por cima ATE do quadro branco, entao e a primeira a sair
  const telaAt = $('#telaAtalhos');
  if (telaAt && !telaAt.classList.contains('hidden')) { telaAt.classList.add('hidden'); return; }
  // o quadro branco fica por cima do resto: e o proximo a sair no Esc
  if (qdPainelAberto()) { if (window.Quadro) window.Quadro.fechar(); return; }
  // o painel dos agentes vem logo depois
  if (agPainelAberto()) { fecharPainelAgentes(); return; }
  // fecha so o painel que de fato esta com o visor aberto, nunca todos de uma vez
  const abertoEm = [...panes.values()].find(P => !$('.p-visor', P.el).classList.contains('hidden'));
  if (abertoEm) { fecharVisor(abertoEm); return; }
  const popupAberto = [...panes.values()].some(P => !$('.p-modal', P.el).classList.contains('hidden'));
  if (popupAberto) { fecharMenus(); for (const P of panes.values()) fecharModal(P); return; }
  /* sem popup, com pedido de autorização à vista no chat em foco: Esc é "Negar" (tela de
     atalhos). Negar é o menor passo: o motor segue e tenta outro caminho, nada é interrompido. */
  if (focusPane && teclaDoPedido(focusPane, e)) return;
  // sem popup: para o que a IA estiver fazendo
  // Esc nunca para chat que ele nao esta olhando: antes um Esc matava o trabalho de TODOS os
  // chats, inclusive os de outra aba, que ele nem via. Perda de trabalho em silencio.
  const alvo = (focusPane && focusPane.busy) ? [focusPane] : [];
  for (const P of alvo) window.api.paneInterrupt({ paneId: P.id, engine: P.engine });
});
/* ↩ / ⌥↩ do pedido com o foco FORA dos campos (clicou na conversa, por exemplo). Dentro do campo
   de escrever quem trata é o keydown dele; em outro campo, botão ou link o Enter é deles; e com
   qualquer coisa aberta por cima o Enter é da camada da frente. Menu, visor e janelinha moram no
   painel dono: só contam os da aba da frente (a mesma conta do anel da caixa, caixa.css). O visor
   esquecido numa aba de fundo está em display:none e não pode travar o ↩ da aba da frente. */
const CAMADA_POR_CIMA = '#telaAtalhos:not(.hidden), #novaAba:not(.hidden), #qdPainel:not(.hidden), #agPainel:not(.hidden),'
  + ' #modalGrupo:not(.hidden), #popGrupo:not(.hidden), .espaco:not(.oculta) .pane .p-modal:not(.hidden),'
  + ' .espaco:not(.oculta) .pane .p-visor:not(.hidden)';
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.defaultPrevented || !focusPane) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, button, a[href], [contenteditable], .term-wrap')) return;
  if (document.querySelector(CAMADA_POR_CIMA)) return;
  teclaDoPedido(focusPane, e);
});

/* `padrao` (redesenho 26/09): o botão ao qual o menu se prende quando não veio de um clique —
   "/" digitado no campo, o "@", atalho, o robô de prints. Com clique, vale o botão clicado. */
function novoMenu(P, padrao) {
  fecharMenus();
  const modal = $('.p-modal', P.el);
  modal.classList.remove('hidden');
  modal.classList.add('como-menu');
  modal.dataset.codexSurface = 'menu';
  modal.onclick = (e) => { if (e.target === modal) fecharMenus(); };
  const cx = $('.modal-cx', modal);
  cx.className = 'modal-cx';
  cx.innerHTML = '';
  cx.onclick = (e) => e.stopPropagation();
  posicionarMenu(P, modal, cx, padrao);
  return cx;
}

/* ---- menu como popover preso ao botão (README do redesenho, "Menus e popovers") ----
   Antes o menu era um cartão no meio do painel, com véu escurecendo a conversa. Agora ele nasce
   colado no botão que o abriu: acima da caixa de escrever para os botões dela, abaixo para os de
   cima. Só POSIÇÃO: o menu continua morando no mesmo .p-modal, fechando e abrindo pelos mesmos
   caminhos. O lugar vai em variáveis de CSS (--menu-*), e não em left/top direto, porque o mesmo
   .modal-cx serve às janelinhas (conta, terminal): variável esquecida ali não mexe em nada, só
   o menus.css a lê, e só com a classe como-menu. No celular o menu sobe do rodapé (celular.css). */
function ancoraDoMenu(P, modal, padrao) {
  const ev = window.event;
  const alvo = ev && ev.target && ev.target.nodeType === 1 ? ev.target : null;
  const visivel = (el) => !!(el && el.isConnected && el.getClientRects().length);
  if (alvo && /^(click|pointer|mouse)/.test(ev.type)) {
    // item de um menu que abriu outro ("/" → Modelo): o clique já apagou o menu de onde ele veio,
    // então o novo fica onde o primeiro estava
    if (alvo.closest('.mi') && (!alvo.isConnected || modal.contains(alvo))) {
      if (visivel(P._ancoraMenu)) return P._ancoraMenu;
    } else if (P.el.contains(alvo)) return alvo.closest('button,[role="button"]') || alvo;
  }
  const p = typeof padrao === 'string' ? $(padrao, P.el) : padrao;
  if (visivel(p)) return p;
  if (visivel(P._ancoraMenu)) return P._ancoraMenu;
  return $('.pane-cmp', P.el);
}
/* O botão dono do menu ganha .menu-dono ao abrir (posicionarMenu) e perde ao fechar
   (fecharMenus). A marca só existe no P._ancoraMenu, então basta limpar ali. */
function soltarDonoMenu(P) {
  const a = P && P._ancoraMenu;
  if (a && a.classList) a.classList.remove('menu-dono');
}
/* Na referência os menus da caixa não param todos no mesmo vão: Comandos e Permissão ficam
   28 acima dela, mas Modelo desce até 2 acima (e fica 20 da borda direita, não 16) e Anexar
   para a 18. Vale só quando o menu nasce do próprio botão: aberto pelo "/" ("/" → Modelo),
   ele fica no lugar do "/". */
function lugarProprioNaCaixa(anc) {
  if (!anc || !anc.matches) return {};
  if (anc.matches('.p-model')) return { vao: 2, dir: 20 };
  if (anc.matches('.p-plus')) return { vao: 18 };
  return {};
}
function posicionarMenu(P, modal, cx, padrao) {
  const s = cx.style;
  for (const k of ['--menu-l', '--menu-r', '--menu-t', '--menu-b', '--menu-alt', '--menu-ox', '--menu-oy']) s.removeProperty(k);
  // a animação de abrir recomeça a cada menu, inclusive quando um menu abre direto de outro
  s.animation = 'none'; void cx.offsetWidth; s.animation = '';
  // lugar de reserva (sem âncora medível): canto de baixo à esquerda, onde fica a caixa
  s.setProperty('--menu-l', '10px'); s.setProperty('--menu-b', '96px');
  let anc;
  try { anc = ancoraDoMenu(P, modal, padrao); } catch { anc = null; }
  if (!anc || !anc.getBoundingClientRect) return;
  soltarDonoMenu(P);
  P._ancoraMenu = anc;
  // o botão que abriu o menu fica marcado enquanto ele está aberto, como no Mac (menus.css,
  // .menu-dono: só os botões da caixa pintam; o nome do chat e o campo de texto, não)
  if (anc.classList) anc.classList.add('menu-dono');
  const mr = modal.getBoundingClientRect(), ar = anc.getBoundingClientRect();
  if (!mr.width || !mr.height) return;
  s.removeProperty('--menu-l'); s.removeProperty('--menu-b');
  const cmp = $('.pane-cmp', P.el);
  const naCaixa = !!(cmp && cmp.contains(anc));
  const base = naCaixa ? cmp.getBoundingClientRect() : ar;
  // botões da esquerda (e faixas largas, como o nome da conversa): o menu cresce para a direita
  const esquerda = ar.width > mr.width / 2 || (ar.left + ar.width / 2) < (mr.left + mr.width / 2);
  const proprio = naCaixa ? lugarProprioNaCaixa(anc) : {};
  // medidas do design (tela de 1470): 10 da borda esquerda do painel, 16 da direita, 8 do botão
  if (esquerda) s.setProperty('--menu-l', Math.max(10, naCaixa ? 10 : Math.round(ar.left - mr.left - 8)) + 'px');
  else s.setProperty('--menu-r', Math.max(16, naCaixa ? (proprio.dir || 16) : Math.round(mr.right - ar.right - 8)) + 'px');
  const sobe = naCaixa || (ar.top + ar.height / 2) > (mr.top + mr.height * 0.55);
  /* vão até o que abriu o menu, medido no design: os menus da caixa de escrever param 28 acima
     dela (/ a 29, Permissão a 27; Modelo e Anexar têm o vão deles) e o do nome do chat fica 4
     abaixo da linha do nome */
  const vao = naCaixa ? (proprio.vao ?? 28) : sobe ? 8 : 4;
  if (sobe) {
    s.setProperty('--menu-b', Math.round(mr.bottom - base.top + vao) + 'px');
    s.setProperty('--menu-alt', Math.max(120, Math.round(base.top - mr.top - vao - 10)) + 'px');
  } else {
    s.setProperty('--menu-t', Math.round(base.bottom - mr.top + vao) + 'px');
    s.setProperty('--menu-alt', Math.max(120, Math.round(mr.bottom - base.bottom - vao - 10)) + 'px');
  }
  s.setProperty('--menu-oy', sobe ? '100%' : '0%');
  s.setProperty('--menu-ox', esquerda ? '0%' : '100%');
  // o menu cresce "a partir do botão": depois de montado (o conteúdo entra logo em seguida),
  // a origem da escala vai para o meio do botão
  requestAnimationFrame(() => {
    if (!cx.isConnected || !modal.classList.contains('como-menu') || P._ancoraMenu !== anc) return;
    const r = cx.getBoundingClientRect(), a = anc.getBoundingClientRect();
    if (!r.width) return;
    const ox = Math.min(r.width, Math.max(0, a.left + a.width / 2 - r.left));
    s.setProperty('--menu-ox', Math.round(ox) + 'px');
  });
}
/* Fechar em 120ms sem atrasar o fechamento de verdade: uma cópia inerte do menu esmaece no mesmo
   lugar e se apaga sozinha. Sem animação no "Reduzir movimento" e no celular (lá o menu é outro). */
const MQ_CELULAR = '(max-width: 820px), (pointer: coarse) and (max-width: 1100px)';
/* O menus.css diz em --menus-mac se o menu está no desenho de popover (sempre no Mac, em qualquer
   largura; no navegador do celular só com tela larga). Sem a variável, vale a consulta do celular. */
function menuEhPopover() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--menus-mac').trim();
  return v ? v === '1' : !matchMedia(MQ_CELULAR).matches;
}
function menuSaindo(cx, pai) {
  try {
    if (!cx || !pai || !cx.firstChild || !cx.cloneNode || !window.matchMedia) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !menuEhPopover()) return;
    const r = cx.getBoundingClientRect(), pr = pai.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const f = cx.cloneNode(true);
    f.classList.add('menu-fantasma');
    f.removeAttribute('id');
    f.setAttribute('aria-hidden', 'true');
    f.inert = true;
    f.onclick = null;
    const pos = getComputedStyle(pai).position === 'fixed' || pai === document.body ? 'fixed' : 'absolute';
    const dx = pos === 'fixed' ? 0 : pr.left + pai.clientLeft, dy = pos === 'fixed' ? 0 : pr.top + pai.clientTop;
    f.style.cssText = cx.style.cssText + ';position:' + pos + ';left:' + (r.left - dx) + 'px;top:' + (r.top - dy)
      + 'px;right:auto;bottom:auto;width:' + r.width + 'px;height:' + r.height + 'px;margin:0';
    pai.appendChild(f);
    const tirar = () => f.remove();
    f.addEventListener('animationend', tirar);
    setTimeout(tirar, 400);
  } catch {}
}
/* Barra de rolagem como a sobreposta do Mac: invisível parada, aparece enquanto a área rola (o
   base.css e o menus.css só pintam o polegar com a classe .rolando, ou com o mouse em cima dele).
   Vale para toda área que rola, não só o / e o @: antes o polegar da conversa ficava sempre à vista.
   Só acende a rolada que vem logo depois de um gesto da pessoa (roda do mouse ou trackpad, toque,
   clique na calha, tecla de rolar fora de campo de texto). A conversa descendo sozinha enquanto o
   assistente escreve não acende: o Mac também não mostra a barra aí, e ela ficaria acesa a resposta
   inteira. O / e o @ acendem sempre, como antes (a seta leva o item escolhido para a vista, e a
   seta é digitada na caixa de escrever). Scroll não sobe na árvore: ouvir em captura. */
let gestoDeRolarEm = 0;
const TECLAS_DE_ROLAR = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);
const marcarGestoDeRolar = () => { gestoDeRolarEm = Date.now(); };
for (const tipo of ['wheel', 'touchmove', 'pointerdown']) {
  document.addEventListener(tipo, marcarGestoDeRolar, { capture: true, passive: true });
}
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
  if (TECLAS_DE_ROLAR.has(e.key)) marcarGestoDeRolar();
}, { capture: true, passive: true });
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (!el || !el.classList) return;
  if (!el.classList.contains('menu-corpo') && Date.now() - gestoDeRolarEm > 300) return;
  if (!el.classList.contains('rolando')) el.classList.add('rolando');
  clearTimeout(el._rolandoT);
  el._rolandoT = setTimeout(() => el.classList.remove('rolando'), 900);
}, true);
/* "⌘⇧F" escondido no fim da explicação vira o atalho à direita do item, na ordem do Mac (⌃⌥⇧⌘) */
function atalhoDoTexto(t) {
  const m = /(?:^|·\s*)([⌃⌥⇧⌘]+)([A-Z0-9,./]|F\d{1,2})\s*$/.exec(String(t || ''));
  if (!m) return '';
  const ordem = '⌃⌥⇧⌘';
  return [...m[1]].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b)).join('') + m[2];
}
/* Item de menu. A marca ✓ vai numa coluna de 12 À ESQUERDA (sempre presente, vazia quando não é o
   atual), e o valor/atalho à direita. O ícone continua no DOM, mas o menus.css só mostra logo de
   assistente e cor de grupo: o design não põe ícone nos menus. */
/* `dica`: a explicação comprida vai SÓ para o balão do mouse (nenhuma frase explicativa na tela).
   `off`: item desativado do Mac (--label-4, sem destaque, o clique não faz nada nem fecha o menu). */
function elItem({ ic, nome, desc, tag, on, off, dica }, aoClicar) {
  const d = document.createElement('div');
  d.className = 'mi' + (on ? ' on' : '') + (off ? ' mi-off' : '');
  d.innerHTML = '<div class="mi-ck">' + (on ? ico('check') : '') + '</div>'
    + '<div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>'
    + (!on && tag ? '<div class="mi-tag"></div>' : '');
  $('.mi-ic', d).innerHTML = ic ? (ICONES[ic] ? ico(ic) : '<span class="ic-txt">' + ic + '</span>') : '';
  $('.mi-n', d).textContent = nome;
  // a explicação continua existindo; quando a lista é de uma linha só, ela vira o balão do mouse
  if (desc) {
    const e = document.createElement('div'); e.className = 'mi-d'; e.textContent = desc;
    $('.mi-txt', d).appendChild(e);
    d.title = nome + ' — ' + desc;
  }
  if (tag && !on) $('.mi-tag', d).textContent = tag;
  if (dica) d.title = nome + ' — ' + dica;
  if (off) { d.setAttribute('aria-disabled', 'true'); return d; }
  d.addEventListener('click', () => { fecharMenus(); aoClicar && aoClicar(); });
  return d;
}
function subPopup(txt) {
  const d = document.createElement('div');
  d.className = 'mo-sub';
  d.textContent = txt;
  return d;
}
/* Redesenho 26/09: menu não tem barra de título nem "×" (fecha no Esc e no clique fora). O nome
   do menu vira o cabeçalho de grupo (11/600) e a frase que explicava o menu vai para o balão do
   mouse (`dica`): nenhuma frase explicativa na tela. */
function tituloPopup(txt, dica) {
  const d = document.createElement('div');
  d.className = 'menu-secao menu-cab';
  d.textContent = txt;
  if (dica) d.title = dica;
  return d;
}
function elSecao(txt) { const d = document.createElement('div'); d.className = 'menu-secao'; d.textContent = txt; return d; }
function elLinha() { const d = document.createElement('div'); d.className = 'menu-linha'; return d; }

/* Trocar o modo de permissão: o menu de Modos e o botão do plano passam por aqui (um caminho só). */
async function escolherModo(P, mo) {
  // trocar de modo desliga o motor: com trabalho rodando, pergunta antes (igual ao fechar)
  const estavaRodando = !!P.busy || agTrabalhando(P);
  if (!confirmarCorte(P, 'Trocar de modo')) return;
  P.mode = mo.id; cfg.defMode = mo.id; window.api.setConfig(cfg); pintarModo(P);
  await desligarMotor(P);
  /* era note(), que so aparece quando e erro: o recado nunca chegou na tela. E a frase
     "parou aqui" so entra quando alguma coisa realmente parou. */
  avisoTemp(P, 'Modo: ' + mo.nome + ' — ' + mo.desc.toLowerCase() + '.'
    + (estavaRodando ? ' O que estava em andamento parou aqui.' : ''));
  savePanes();
}

/* ---- menu de Modos ---- */
function menuModos(P) {
  const m = novoMenu(P, '.p-modo');
  m.classList.add('menu-modo');
  m.appendChild(tituloPopup('Modo de permissão', 'O que ele pode fazer sem te perguntar.'));

  for (const mo of MODOS[P.engine]) {
    // "Sem pedir permissão" fica separado dos outros por uma linha (design): é o que não pergunta nada
    if (mo.id === 'bypass') m.appendChild(elLinha());
    // no menu vai a linha curta do design; a explicação inteira continua no balão do mouse
    const item = elItem({ ic: mo.ic, nome: mo.nome, desc: mo.curta || mo.desc, on: mo.id === modoDe(P).id }, () => escolherModo(P, mo));
    item.title = mo.nome + ' — ' + mo.desc;
    m.appendChild(item);
  }
}

/* ---- menu de modelos (no cabeçalho) ---- */
async function menuModelos(P) {
  const m = novoMenu(P, '.p-model');
  m.classList.add('menu-modelo');
  // marca esta janelinha: se a resposta atrasada de codexModels() chegar depois que o
  // usuario ja fechou o menu e abriu outra coisa (terminal, foto...), nao repinta por cima (R3-033)
  const modal = $('.p-modal', P.el);
  const geracao = modal.dataset.geracaoMenu = 'md' + Date.now() + Math.random();
  const pintar = () => {
    m.innerHTML = '';
    /* [EDITA leva 12.4, só o texto] no painel ACP este menu não escolhe cérebro: escolhe o
       AGENTE, e o que vale é a linha de comando que sobe o processo. */
    // redesenho 26/09: a frase que explicava o menu saiu da tela e virou o balão do cabeçalho
    m.appendChild(tituloPopup(P.engine === 'acp' ? 'Agente' : 'Modelo', P.engine === 'acp'
      ? 'Qual agente ACP este painel vai subir. Precisa estar instalado nesta máquina.'
      : 'Qual cérebro este painel vai usar, e quanto ele deve pensar.'));
    for (const mo of modelosDe(P)) {
      // leva 12.5: no ACP o menu diz o que está e o que NÃO está instalado nesta máquina
      const faltando = P.engine === 'acp' && !agenteAcpTem(mo);
      m.appendChild(elItem({ nome: mo.nome, desc: mo.desc + (faltando ? ' · não está instalado neste Mac' : ''), on: mo.id === P.model }, async () => {
        const vaiPorCreditos = modeloPorCreditos(mo.id);
        const mudouOrigem = modeloPorCreditos(P.model) !== vaiPorCreditos;
        // Codex sem mudar de cobrança segue por mudarEscolhasCodex, que nunca derruba o turno
        // (aplica ao vivo ou fica pendente); so os outros casos de fato matam o motor — o aviso
        // so pode ameacar perder trabalho quando isso e verdade (R3-006)
        const destroi = !(P.engine === 'codex' && !mudouOrigem && !vaiPorCreditos);
        // trocar de modelo desliga o motor: pergunta ANTES de mexer em P.model, senão a UI já
        // muda visualmente antes dele confirmar/cancelar
        if (mo.id !== P.model && destroi && !confirmarCorte(P, 'Trocar de modelo')) return;
        P.model = mo.id;
        const ef = esforcosDe(P);
        if (ef.length && !ef.find(e => e.id === P.effort)) P.effort = mo.padraoEffort || ef[0].id;
        fillModels(P);
        lembrarEscolhaDaPasta(P);        // esta pasta passa a nascer com este cérebro
        if (P.engine === 'codex' && !mudouOrigem && !vaiPorCreditos) {
          await mudarEscolhasCodex(P, { model: mo.id, effort: P.effort });
        } else await desligarMotor(P);
        if (mudouOrigem) {
          if (P.hist.length) P.passarContexto = montarContexto(P, true, 'troca-de-cobranca');
          guardarParteAnterior(P);   // 25/09: a conversa nova do plano/créditos continua a mesma na lista
          P.sessaoId = null; P.resumeId = null; P.sessaoFile = '';
          zerarContexto(P);         // conversa nova: o medidor volta ao zero
          P.forkPendente = false;   // leva 8.3: conversa nova, sem ramo pendente
          note(P, vaiPorCreditos
            ? 'A próxima mensagem usa créditos da API dentro do limite escolhido.'
            : 'A próxima mensagem volta a usar o seu plano do Codex.');
        }
        savePanes();
      }));
    }
    m.appendChild(elLinha());
    if (P.engine === 'acp') m.appendChild(elItem({ nome: 'Outro agente…', desc: 'Informe o comando de um agente que fale ACP' }, async () => {
      const comando = await perguntarTexto(P, 'Comando do agente', 'Exemplo: opencode acp', P.model || '');
      if (!comando || !comando.trim()) return;
      await desligarMotor(P);
      if (P.hist.length) P.passarContexto = montarContexto(P, true, 'troca-de-agente');
      guardarParteAnterior(P);   // 25/09: o agente novo continua a mesma conversa na lista
      P.model = comando.trim(); P.sessaoId = null; P.resumeId = null; P.sessaoFile = '';
      zerarContexto(P);          // conversa nova: o medidor volta ao zero
      fillModels(P); savePanes();
    }));
    if (['acp', 'grok'].includes(P.engine) && P.acpInfo?.modelos?.length) {
      m.appendChild(elSecao('Modelos anunciados pelo agente'));
      for (const modelo of P.acpInfo.modelos) m.appendChild(elItem({ nome: modelo.nome || modelo.id, desc: modelo.desc || '', on: modelo.id === P.acpInfo.modeloAtual }, async () => {
        const r = await window.api.acpConfig({ paneId: P.id, modelo: modelo.id });
        if (r?.error) { note(P, r.error, true); return; }
        P.acpInfo.modeloAtual = modelo.id;
      }));
    }
    if (P.engine === 'claude' || P.engine === 'codex') m.appendChild(barraEsforco(P));   // no ACP quem decide o esforço é o agente
    secoesCodexNoCerebro(P, m, pintar);
  };
  pintar();
  if (P.engine === 'codex' && !MODELOS_CODEX) {
    // NAO gravar array vazio em MODELOS_CODEX: [] e verdadeiro em JS, entao o "!MODELOS_CODEX"
    // acima nunca mais buscaria de novo mesmo com o Codex de volta ao ar (mesmo padrao do boot)
    const ms = await window.api.codexModels();
    // a janelinha pode ter virado terminal/foto/conta/outro menu enquanto isso demorava
    if (modal.classList.contains('hidden') || !modal.classList.contains('como-menu')
      || modal.dataset.codexSurface !== 'menu' || modal.dataset.geracaoMenu !== geracao) return;
    if (ms && ms.length) { MODELOS_CODEX = traduzCodex(ms); fillModels(P); pintar(); }
  }
}

/* ---- menu do + ---- */
/* Redesenho 26/09: sem título nem frase de explicação (o design não tem), uma linha por item com
   os nomes do design ("…" = abre outra janela) e uma linha separando o que CAPTURA (recortar,
   fotografar) do que escolhe arquivo. A explicação de cada item continua no balão do mouse. */
function menuAnexo(P) {
  const m = novoMenu(P, '.p-plus');
  m.classList.add('menu-anexo', 'menu-1linha');
  m.setAttribute('aria-label', 'Anexar');
  const itens = [
    /* Escolher arquivo e escolher pasta sao janelas do MAC. No telefone os dois so davam um
       alerta dizendo que nao dava: dois becos sem saida dentro do menu. Fora da lista, do
       mesmo jeito que o "Recortar a tela" ja fazia. */
    ...(window.SEM_ELECTRON ? [] : [{ ic: 'upload', nome: 'Do computador…', desc: 'escolher arquivos', act: 'file' }]),
    /* No telefone este vira o UNICO caminho de arquivo, e a galeria do iPhone tambem entrega
       video — por isso o nome muda la. No Mac o seletor continua aceitando so imagem. */
    { ic: 'image', nome: window.SEM_ELECTRON ? 'Foto ou vídeo…' : 'Imagem…',
      desc: window.SEM_ELECTRON ? 'da galeria do celular' : 'png, jpg, webp', act: 'image' },
    ...(window.SEM_ELECTRON ? [] : [{ ic: 'folder', nome: 'Pasta…', desc: 'manda o caminho da pasta', act: 'folder' }]),
    { ic: 'map-pin', nome: 'Pasta deste painel', desc: shortPath(P.cwd), act: 'cwd' },
    /* Recortar a tela esconde a janela do MAC e abre uma tela preta por cima de tudo la: pelo
       telefone isso ficaria preso a quilometros de distancia. Por isso o item nem existe la. */
    ...(window.SEM_ELECTRON ? [] : [{ ic: 'crop', nome: 'Recortar a tela', desc: 'esconde o Cockpit, você arrasta o pedaço e ele vira anexo', act: 'recorte' }]),
    { ic: 'camera', nome: 'Fotografar', desc: 'pela câmera: rascunho no papel, quadro físico, o que estiver na sua frente', act: 'foto' },
  ];
  let separou = false;
  for (const i of itens) {
    if (!separou && (i.act === 'recorte' || i.act === 'foto')) { separou = true; m.appendChild(elLinha()); }
    m.appendChild(elItem(i, async () => {
      if (i.act === 'cwd') return inserirNoInput(P, P.cwd);
      if (i.act === 'recorte') return recortarTela(P);
      if (i.act === 'foto') return fotografar(P);
      const files = await window.api.pickFiles(i.act);
      if (files && files.length) {
        if (i.act === 'folder') inserirNoInput(P, files.join(' '));
        else await anexar(P, files);
      }
    }));
  }
}

/* ---- puxar a aba aberta do navegador para dentro da conversa ---- */
async function puxarAbaDoNavegador(P) {
  const r = await window.api.abaDoNavegador();
  if (!r || r.error) { avisoEnvio(P, (r && r.error) || 'não consegui falar com o navegador'); return; }
  inserirNoInput(P, r.titulo ? r.titulo + ' — ' + r.url : r.url);
}

/* ---- o que manda no comportamento do Claude, numa tela só ----
   Redesenho (25/09): sheet de 680 com as quatro partes em abas (Memória, Agentes, Hooks,
   Permissões), a lista à esquerda (220) e a prévia em mono à direita. Continua só LENDO:
   mexer nesses arquivos muda o Claude em todos os projetos, então a edição é dele — o
   "Abrir no Mac…" abre o arquivo do item escolhido. A prévia usa a mesma leitura do visor. */
async function janelaConfiguracao(P) {
  fecharMenus();
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  // R9: sem estas duas linhas, um painel que já mostrou a Conta do Codex repintaria a conta aqui por cima
  modal.classList.remove('como-menu');
  modal.dataset.codexSurface = '';
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.onclick = (e) => e.stopPropagation();
  cx.className = 'modal-cx cx-config';
  const topo = '<div class="mo-top"><span class="mo-logo" data-motor="claude"></span>'
    + '<span class="mo-tit" title="O que está valendo hoje. Mexer nestes arquivos muda o Claude em todos os projetos, então a edição é por sua conta: clique em Abrir no Mac.">Configuração do Claude</span>'
    + '<span class="mo-gap"></span><span class="cf-pasta"></span>'
    + '<button class="mo-x" title="Fechar">' + ico('x') + '</button></div>';
  const pintarTopo = () => {
    const l = $('.mo-logo', cx); if (l) l.innerHTML = svgMotor('claude');
    const pa = $('.cf-pasta', cx); if (pa) { pa.textContent = shortPath(P.cwd || ''); pa.title = P.cwd || ''; }
    $('.mo-x', cx).onclick = () => fecharModal(P);
  };
  cx.innerHTML = topo + '<div class="mo-carregando">Lendo a configuração…</div>';
  pintarTopo();

  const c = await window.api.configClaude();
  if (modal.classList.contains('hidden')) return;
  if (!c || c.error) { cx.innerHTML = topo + '<div class="mo-erro">Não consegui ler: ' + escHtml((c && c.error) || 'erro') + '</div>'; pintarTopo(); return; }

  const kb = (n) => n ? (n / 1024).toFixed(1).replace('.', ',') + ' KB' : 'vazio';
  // o settings.json e lido uma vez so, na primeira aba que precisar dele (hooks e permissões)
  let ajustes = null;
  const lerAjustes = async () => {
    if (ajustes) return ajustes;
    const a = await lerParaVisor(c.arquivoAjustes);
    try { ajustes = JSON.parse((a && a.dados) || '{}'); } catch { ajustes = {}; }
    return ajustes;
  };
  const lerTexto = async (caminho) => {
    const a = await lerParaVisor(caminho);
    if (!a || a.erro) return 'Não consegui ler: ' + ((a && a.erro) || 'erro');
    return a.tipo === 'texto' ? a.dados : 'Este tipo não abre aqui dentro.';
  };
  // a memória da PASTA do chat (quando existe) entra na lista, como no desenho
  const memorias = [];
  if (P.cwd && !NA_VPS(P.cwd)) {
    try {
      const proj = await lerParaVisor(String(P.cwd).replace(/\/+$/, '') + '/CLAUDE.md');
      if (proj && !proj.erro) memorias.push({ t: 'CLAUDE.md', s: 'Projeto · ' + kb(proj.bytes), caminho: String(P.cwd).replace(/\/+$/, '') + '/CLAUDE.md', mono: true });
    } catch {}
  }
  memorias.push({ t: shortPath(c.memoria.global.caminho), s: 'Todos os projetos · ' + kb(c.memoria.global.tamanho), caminho: c.memoria.global.caminho, mono: true });
  memorias.push({ t: shortPath(c.memoria.casa.caminho), s: 'Mapa da casa · ' + kb(c.memoria.casa.tamanho), caminho: c.memoria.casa.caminho, mono: true });
  const pastaAgentes = String(c.arquivoAjustes || '').replace(/\/[^/]*$/, '') + '/agents/';
  const perm = (k) => async () => { const a = await lerAjustes(); const l = ((a.permissions || {})[k]) || []; return l.length ? l.join('\n') : 'nenhuma'; };
  const ABAS = {
    memoria: { nome: 'Memória', itens: memorias.map(m => ({ ...m, previa: () => lerTexto(m.caminho) })) },
    agentes: { nome: 'Agentes', vazio: 'Nenhum agente',
      rodape: c.skills + (c.skills === 1 ? ' skill instalada' : ' skills instaladas'),
      itens: c.agentes.map(n => ({ t: n, s: 'Agente', caminho: pastaAgentes + n + '.md', mono: true, previa: () => lerTexto(pastaAgentes + n + '.md') })) },
    hooks: { nome: 'Hooks', vazio: 'Nenhum hook ligado',
      itens: c.hooks.map(h => ({ t: h, s: 'Hook', caminho: c.arquivoAjustes, mono: true,
        previa: async () => JSON.stringify(((await lerAjustes()).hooks || {})[h], null, 2) || '' })) },
    permissoes: { nome: 'Permissões', itens: [
      { t: 'Modo padrão', s: String(c.permissoes.modo), caminho: c.arquivoAjustes, previa: async () => 'defaultMode: ' + c.permissoes.modo },
      { t: 'Liberadas', s: c.permissoes.liberado + ' regras', caminho: c.arquivoAjustes, previa: perm('allow') },
      { t: 'Negadas', s: c.permissoes.negado + ' regras', caminho: c.arquivoAjustes, previa: perm('deny') },
      { t: 'Perguntam', s: c.permissoes.pergunta + ' regras', caminho: c.arquivoAjustes, previa: perm('ask') },
    ] },
  };

  cx.innerHTML = topo
    + '<div class="cf-seg" role="tablist">'
    + Object.entries(ABAS).map(([k, a]) => '<button role="tab" data-aba="' + k + '">' + a.nome + '</button>').join('')
    + '</div>'
    + '<div class="cf-corpo"><div class="cf-lista"></div><pre class="cf-previa"></pre></div>'
    + '<div class="mo-rodape"><button class="mo-btn" id="cfAbrir">Abrir no Mac…</button>'
    + '<button class="mo-btn destaque" id="cfOk">Concluir</button></div>';
  pintarTopo();
  const lista = $('.cf-lista', cx), previa = $('.cf-previa', cx), abrir = $('#cfAbrir', cx);
  let escolhido = null, vez = 0;
  const escolher = async (it, bt) => {
    escolhido = it;
    $$('.cf-item', lista).forEach(b => b.classList.toggle('on', b === bt));
    abrir.disabled = !it || !it.caminho;
    if (!it) { previa.textContent = ''; return; }
    const minha = ++vez;
    previa.textContent = 'Lendo…';
    let txt = '';
    try { txt = await it.previa(); } catch (e) { txt = 'Não consegui ler: ' + (e.message || e); }
    if (minha !== vez) return;   // clicou em outro item antes desta leitura voltar
    /* linha por linha: a de titulo do markdown (# e ##) ganha a cor um tom abaixo, como no
       desenho; o resto entra como texto puro (textContent — nada do arquivo vira HTML) */
    previa.textContent = '';
    const linhas = String(txt || '').split('\n').slice(0, 400);
    linhas.forEach((linha, n) => {
      if (/^#{1,6} /.test(linha)) {
        const h = document.createElement('span'); h.className = 'cf-h'; h.textContent = linha;
        previa.appendChild(h);
      } else previa.appendChild(document.createTextNode(linha));
      if (n < linhas.length - 1) previa.appendChild(document.createTextNode('\n'));
    });
    previa.scrollTop = 0;
  };
  const mostrarAba = (k) => {
    const a = ABAS[k];
    $$('.cf-seg button', cx).forEach(b => b.classList.toggle('on', b.dataset.aba === k));
    lista.innerHTML = '';
    for (const it of a.itens) {
      const b = document.createElement('button');
      b.className = 'cf-item';
      b.innerHTML = '<span class="cf-item-t"></span><span class="cf-item-s"></span>';
      $('.cf-item-t', b).textContent = it.t;
      $('.cf-item-t', b).classList.toggle('mono', !!it.mono);
      $('.cf-item-s', b).textContent = it.s;
      b.title = it.caminho || '';
      b.onclick = () => escolher(it, b);
      lista.appendChild(b);
    }
    if (!a.itens.length) { const v = document.createElement('div'); v.className = 'cf-vazio'; v.textContent = a.vazio || 'Nada aqui'; lista.appendChild(v); }
    if (a.rodape) { const r = document.createElement('div'); r.className = 'cf-vazio'; r.textContent = a.rodape; lista.appendChild(r); }
    escolher(a.itens[0] || null, $('.cf-item', lista));
  };
  $$('.cf-seg button', cx).forEach(b => b.onclick = () => mostrarAba(b.dataset.aba));
  abrir.onclick = () => { if (escolhido && escolhido.caminho) window.api.openPath(escolhido.caminho); };
  $('#cfOk', cx).onclick = () => fecharModal(P);
  mostrarAba('memoria');
}

/* ---- modo foco: só a pergunta e a resposta ----
   Os passos do motor (comandos, leituras, buscas) são muitos e roubam a atenção. Este botão
   esconde tudo isso de uma vez, na tela inteira, e fica lembrado. */
function alternarFoco() {
  const ligado = !document.body.classList.contains('foco');
  // esconder/mostrar os passos muda a altura de TODA conversa, de TODAS as abas. Antes isto
  // jogava todo mundo pro fim de proposito (medido: pulos de ate 14 telas). Agora cada chat
  // volta pra onde estava — e quem ja estava colado no fim continua colado, pelo 'noFim'.
  const vivos = [...panes.values()];
  vivos.forEach(guardarRolagem);
  document.body.classList.toggle('foco', ligado);
  cfg.foco = ligado; window.api.setConfig(cfg);
  requestAnimationFrame(() => {
    for (const P of vivos) { if (panes.has(P.id)) P.rolagemPendente = !devolverRolagem(P); }
  });
  return ligado;
}

/* ---- reabrir o último chat fechado ---- */
const fechadosRecentes = [];
function guardarFechado(P) {
  if (!P.resumeId && !P.sessaoId && !P.hist.length) return;   // chat vazio não vale guardar
  fechadosRecentes.push({
    engine: P.engine, cwd: P.cwd, titulo: P.titulo,
    resumeId: P.sessaoId || P.resumeId || '', arquivo: P.sessaoFile || '',
    aid: P.aid,
    // R2-033: guarda o worktree pra reabrir devolver o chat na branch isolada, não na pasta principal
    worktree: (P.worktree && !NA_VPS(P.cwd)) ? P.worktree : '',
  });
  if (fechadosRecentes.length > 20) fechadosRecentes.shift();
}
async function reabrirUltimoFechado() {
  const f = fechadosRecentes.pop();
  if (!f) { if (focusPane) avisoTemp(focusPane, 'Nenhum chat fechado nesta sessão.'); return; }
  if (f.resumeId) {
    const P = await openSession({ id: f.resumeId, engine: f.engine, cwd: f.cwd, title: f.titulo || '', file: f.arquivo }, null);
    // R2-033: openSession sempre zera P.worktree — repõe aqui, igual o boot faz em restaurarAbasCorpo
    // Só reaplica se o painel nasceu agora (R3-008): se openSession devolveu um painel que já
    // estava aberto e em uso, sobrescrever o worktree dele em silêncio muda a pasta por baixo dele.
    if (P && f.worktree && !NA_VPS(f.cwd)) {
      if (P._painelNovoDeAbertura) { P.worktree = f.worktree; mostrarPastaNoPainel(P); }
      else avisoTemp(P, 'Esta conversa já estava aberta com outra pasta: o worktree salvo não foi aplicado.');
    }
    if (P) delete P._painelNovoDeAbertura;
    return;
  }
  // a aba antiga pode ja nao existir mais (foi fechada): reabrir nao pode cair em
  // qualquer aba ativa de OUTRO projeto, tem que nascer numa aba do projeto certo (f.cwd).
  // Mesma regra do openSession: se o cliente ja tem aba aberta, entra nela em vez de
  // criar uma segunda aba da mesma pasta.
  const A = abas.get(f.aid) || abaDoCaminho(f.cwd, true);
  ativarAbaProjeto(A);
  const Q = newPane({ engine: f.engine, aba: A, cwd: f.cwd, titulo: f.titulo });
  if (Q) setFocus(Q);
}

/* ---- as skills que ele mais usa sobem para o topo ---- */
const QUANTAS_FAVORITAS = 8;
function contarUsoDeSkill(nome) {
  if (!nome) return;
  cfg.usoSkills = cfg.usoSkills || {};
  cfg.usoSkills[nome] = (cfg.usoSkills[nome] || 0) + 1;
  window.api.setConfig(cfg);
}
function maisUsadas(skills) {
  const uso = cfg.usoSkills || {};
  return skills
    .filter(sk => uso[sk.name])
    .sort((a, b) => uso[b.name] - uso[a.name])
    .slice(0, QUANTAS_FAVORITAS);
}

/* ---- menu do / (ações, modelo e comandos) ---- */
async function menuSkills(P, filtroInicial, focar) {
  const m = novoMenu(P, '.p-slash');
  m.classList.add('menu-1linha', 'menu-cmd');   // uma linha por item; a explicação vira o balão do mouse
  // redesenho 26/09: sem barra de título; o campo de filtro (lupa + "Filtrar") abre o menu
  m.setAttribute('aria-label', 'Ações e comandos');
  const campo = document.createElement('label');
  campo.className = 'menu-filtro';
  campo.innerHTML = ico('search');
  const busca = document.createElement('input');
  busca.className = 'menu-search';
  busca.placeholder = 'Filtrar';
  busca.setAttribute('aria-label', 'Filtrar ações e comandos');
  campo.appendChild(busca);
  m.appendChild(campo);
  const corpo = document.createElement('div');
  corpo.className = 'menu-corpo';
  m.appendChild(corpo);

  /* A ORDEM aqui e a ordem na tela: a secao nasce quando muda de nome. Antes as linhas estavam
     misturadas (Contexto, Chat, Contexto de novo…) e "Contexto" aparecia tres vezes no mesmo
     menu. Agora vem tudo junto por secao, com Modelo e Conta no topo — que e o que ele mais
     abre o menu para mexer. */
  const acoes = [
    // nomes do design: o item diz O QUE é (Modelo, Modo de permissão), o valor atual fica à direita
    { sec: 'Modelo', ic: 'brain', nome: 'Modelo', tag: modeloAtual(P).nome, act: () => menuModelos(P) },
    { sec: 'Modelo', ic: 'sliders-horizontal', nome: 'Esforço', tag: EF_PT[P.effort] || P.effort, act: () => menuModelos(P) },
    { sec: 'Modelo', ic: 'lock', nome: 'Modo de permissão', tag: modoDe(P).nome, act: () => menuModos(P) },
    { sec: 'Modelo', ic: 'arrow-left-right', nome: 'Assistente', tag: nomeDoMotor(P.engine), desc: 'escolher Claude, Codex, Gemini ou Grok', act: () => menuMotores(P) },
    // Eram cinco linhas aqui (trocar conta, entrar com codigo, logout, conta, ver conta) e as
    // cinco levavam ao mesmo lugar. Ficou UMA: a janela da conta ja tem todos esses botoes.
    { sec: 'Conta', ic: 'user', nome: 'Conta', tag: (contaCache[P.engine] && contaCache[P.engine].email) || '', desc: 'quem está entrado, limite de uso, trocar ou sair' + (NA_VPS(P.cwd) ? ' · na VPS' : ''), act: () => janelaConta(P) },
    /* Linha NOVA, e o nome dela nao pode ser "Trocar de conta": esse botao ja existe na janela
       da Conta e faz OUTRA coisa (sai e entra pelo CLI, com navegador). Aqui e' so alternar
       entre contas ja logadas, trocando o arquivo de credencial guardado. */
    { sec: 'Conta', ic: 'arrow-left-right', nome: 'Contas guardadas…', desc: 'alternar entre contas já logadas, sem refazer login', act: () => menuContas(P) },
    { sec: 'Contexto', ic: 'upload', nome: 'Anexar arquivo…', act: () => menuAnexo(P) },
    { sec: 'Contexto', ic: 'folder', nome: 'Mencionar a pasta deste painel', act: () => inserirNoInput(P, P.cwd) },
    { sec: 'Contexto', ic: 'eraser', nome: 'Limpar a tela', desc: 'a conversa continua', act: () => { P.chat.innerHTML = ''; P.blocks.clear(); P.tools.clear(); P.rolagem = null; } },
    { sec: 'Contexto', ic: 'file-text', nome: 'Resumir a conversa', desc: 'libera espaço sem perder o fio', act: () => compactarConversa(P) },
    { sec: 'Contexto', ic: 'search', nome: 'Buscar nesta conversa', desc: '⌘F', act: () => abrirBuscaConversa(P) },
    { sec: 'Contexto', ic: 'lock', nome: 'Modo foco', desc: 'esconde os passos, deixa só pergunta e resposta · ⌘⇧F', tag: document.body.classList.contains('foco') ? 'ligado' : '', act: () => alternarFoco() },
    /* Estes dois so acontecem no MAC: o navegador que se le e o de la, e o vault mora no disco
       de la. No telefone o toque nao fazia nada e o app nao dizia por que — entao aqui eles
       nem aparecem, do mesmo jeito que o "Recortar a tela" ja fazia no menu do +. */
    ...(window.SEM_ELECTRON ? [] : [
      { sec: 'Contexto', ic: 'plug', nome: 'Puxar a aba aberta do navegador', desc: 'manda o endereço e o título da aba de agora', act: () => puxarAbaDoNavegador(P) },
      { sec: 'Contexto', ic: 'book', nome: 'Salvar no Obsidian', desc: 'vira nota no vault, na pasta do cliente', act: () => salvarConversaNoVault(P) },
    ]),
    // ditar FICA no telefone: ele grava pelo microfone do proprio celular e o Mac so passa o
    // texto a limpo (o mesmo caminho da foto e do OCR)
    { sec: 'Contexto', ic: 'mic', nome: 'Ditar', desc: 'falar em vez de digitar · ⌘⇧D', act: () => alternarDitado(P) },
    /* UMA linha so para "abrir chat novo", e com o MESMO nome que o menu do Mac (⌘T), o botao
       do topo e a coluna lateral usam. Antes havia outra linha aqui em cima, na secao Contexto
       ("Comecar conversa nova"), que por dentro chamava esta mesma funcao: duas portas com
       nomes diferentes para a mesma coisa. */
    { sec: 'Chat', ic: 'plus', nome: 'Novo chat nesta aba', desc: '⌘T', act: () => { novoChatNaAba(P.engine); } },
    { sec: 'Chat', ic: 'rotate-cw', nome: 'Reabrir o último chat fechado', desc: '⌘⇧W', act: () => reabrirUltimoFechado() },
    { sec: 'Chat', ic: 'columns-2', nome: 'Perguntar aos outros motores', desc: 'a mesma pergunta nos outros chats desta aba · ⌘D', act: () => perguntarAosOutros(P) },
    { sec: 'Painel', ic: 'folder-open', nome: 'Trocar a pasta deste painel', tag: nomePasta(P.cwd), act: () => $('.p-cwd', P.el).click() },
    // a memoria, os agentes e os hooks sao arquivos do MAC: no telefone a janela so abria para
    // dizer que nao conseguiu ler. Fora da lista, como o "Recortar a tela".
    ...(window.SEM_ELECTRON ? [] : [{ sec: 'Painel', ic: 'sliders-horizontal', nome: 'Configurar o Claude', desc: 'memória, agentes, hooks e permissões', act: () => janelaConfiguracao(P) }]),
    // terminal abre um shell de verdade no Mac: term:run é bloqueado do celular, então o item some de lá (R3-024)
    ...(window.SEM_ELECTRON ? [] : [{ sec: 'Painel', ic: 'terminal', nome: 'Terminal', desc: 'rodar comandos aqui dentro, sem abrir o Terminal do Mac', act: () => janelaTerminal(P, 'cd ' + JSON.stringify(P.cwd) + ' 2>/dev/null; exec ${SHELL:-/bin/zsh} -l', 'Terminal — ' + nomePasta(P.cwd)) }]),
    /* Item NOVO, ao lado do terminal de sempre (que continua abrindo aqui no Mac). So aparece
       em painel da VPS. Quem monta a linha do ssh e o main: host e usuario nao saem de la. */
    ...(window.SEM_ELECTRON || !NA_VPS(P.cwd) ? [] : [{ sec: 'Painel', ic: 'terminal', nome: 'Terminal na VPS', desc: 'shell de verdade lá dentro, na pasta deste painel', act: () => abrirTerminalVps(P) }]),
    /* leva 10.5: branch isolada. Aparece SEMPRE — inclusive no Codex e na VPS, onde entrar é
       recusado com o motivo escrito, mas SAIR precisa continuar possível (ele pode ter
       trocado de motor depois de entrar). */
    { sec: 'Painel', ic: 'git-branch', nome: P.worktree ? 'Sair do worktree "' + P.worktree + '"' : 'Abrir em worktree…',
      tag: P.worktree ? 'ativo' : '',   // era o símbolo de texto ⎇; o valor à direita diz o estado
      desc: P.worktree ? 'volta a trabalhar na pasta principal deste chat'
        : 'branch isolada em .claude/worktrees: experimenta sem sujar a branch de verdade (só Claude)',
      act: () => alternarWorktree(P) },
    { sec: 'Conectores', ic: 'plug', nome: 'Conectores', desc: 'ver, reconectar ou adicionar um conector', act: () => janelaConectores(P) },
    /* As duas ultimas de propósito: a seção nasce quando o nome muda, então grudadas aqui no
       FIM elas viram uma seção "Prompts" própria, sem quebrar nenhuma das de cima. */
    { sec: 'Prompts', ic: 'star', nome: 'Salvar o texto do campo como prompt…', desc: 'para reaproveitar pedidos longos (fica em ~/.claude/cockpit-prompts.json)', act: () => salvarPromptDoCampo(P) },
    { sec: 'Prompts', ic: 'eraser', nome: 'Apagar um prompt salvo…', act: () => apagarPromptSalvo(P) },
  ];

  let skills = [];
  let prompts = [];
  const pintar = (f) => {
    corpo.innerHTML = '';
    const q = (f || '').toLowerCase().replace(/^\//, '');
    let secAtual = '';
    for (const a of acoes) {
      if (q && !a.nome.toLowerCase().includes(q)) continue;
      if (a.sec !== secAtual) { secAtual = a.sec; corpo.appendChild(elSecao(a.sec)); }
      // à direita: o valor atual (tag) ou, sem ele, o atalho que estava escondido na explicação
      corpo.appendChild(elItem({ ...a, tag: a.tag || atalhoDoTexto(a.desc) }, () => {
        const inp = $('.p-input', P.el);
        if (inp.value.startsWith('/') && !inp.value.includes(' ')) { inp.value = ''; inp.style.height = 'auto'; }
        a.act();
      }));
    }
    // quem bate no nome vem antes de quem so bate na descricao
    const porNome = skills.filter(sk => q && sk.name.toLowerCase().includes(q));
    const porDesc = q ? skills.filter(sk => !sk.name.toLowerCase().includes(q) && (sk.desc || '').toLowerCase().includes(q)) : skills;
    const usarSkill = (sk) => {
      const inp = $('.p-input', P.el);
      if (inp.value.startsWith('/') && !inp.value.includes(' ')) inp.value = '';
      contarUsoDeSkill(sk.name);
      inserirNoInput(P, '/' + sk.name);
    };
    // Sao 382 skills e o menu so mostra 150, em ordem fixa: as que ele usa todo dia podiam nem
    // aparecer. Agora as mais usadas sobem para o topo, com secao propria.
    if (!q) {
      const favoritas = maisUsadas(skills);
      if (favoritas.length) {
        corpo.appendChild(elSecao('As que você mais usa'));
        for (const sk of favoritas) corpo.appendChild(elItem({ ic: '/', nome: sk.name, desc: sk.desc }, () => usarSkill(sk)));
      }
    }
    /* prompts salvos: filtram pelo nome E pelo comeco do texto (o nome dele e curto, mas o
       que ele lembra as vezes e uma palavra de dentro do prompt). Clicar cola no campo. */
    const promptsVis = prompts.filter((p) => !q || String(p.nome || '').toLowerCase().includes(q) || String(p.texto || '').toLowerCase().includes(q)).slice(0, 40);
    if (promptsVis.length) {
      corpo.appendChild(elSecao('Prompts salvos (' + prompts.length + ')'));
      for (const p of promptsVis) corpo.appendChild(elItem({ ic: 'star', nome: p.nome, desc: String(p.texto || '').replace(/\s+/g, ' ').slice(0, 90) }, () => {
        const inp = $('.p-input', P.el);
        if (inp.value.startsWith('/') && !inp.value.includes(' ')) inp.value = '';
        inserirNoInput(P, p.texto);
      }));
    }
    const vis = (q ? [...porNome, ...porDesc] : skills).slice(0, 150);
    if (vis.length) {
      corpo.appendChild(elSecao('Comandos e skills' + (skills.length ? ' (' + skills.length + ')' : '')));
      for (const sk of vis) corpo.appendChild(elItem({ ic: '/', nome: sk.name, desc: sk.desc }, () => usarSkill(sk)));
    } else if (!corpo.children.length) {
      corpo.innerHTML = '<div class="menu-empty">Nada encontrado.</div>';
    }
  };
  busca.value = filtroInicial || '';
  pintar(busca.value);
  busca.addEventListener('input', () => pintar(busca.value));
  if (filtroInicial === undefined || focar) setTimeout(() => { busca.focus(); busca.setSelectionRange(busca.value.length, busca.value.length); }, 30);
  /* As duas listas ao mesmo tempo: esperar uma depois da outra dobraria a espera do menu.
     O `window.api.promptsLer ?` e cinto de seguranca — se um dia a tela abrir num app antigo,
     sem essa ponte, o menu inteiro morreria num TypeError em vez de ficar so' sem prompts. */
  [skills, prompts] = await Promise.all([
    // { engine, cwd } em vez de só o motor: no Codex quem sabe as skills de verdade é o
    // app-server, e a resposta dele depende da PASTA deste painel
    // leva 12.4: o `paneId` entrou junto — no ACP os comandos "/" são os que o agente DAQUELE
    // painel anunciou; para o Claude e o Codex o campo a mais é ignorado
    Promise.resolve(window.api.skills({ engine: P.engine, cwd: P.cwd, paneId: P.id })).then((s) => s || []).catch(() => []),
    window.api.promptsLer ? window.api.promptsLer().then((p) => p || []).catch(() => []) : [],
  ]);
  pintar(busca.value);
}

/* ---- prompts salvos: reaproveitar pedidos longos sem redigitar ---- */
async function salvarPromptDoCampo(P) {
  const inp = $('.p-input', P.el);
  const texto = (inp && inp.value.trim()) || '';
  if (!texto) { note(P, 'Escreva o prompt no campo primeiro; depois salve por aqui.', true); return; }
  const nome = await perguntarTexto(P, 'Salvar prompt', 'Um nome curto para achar depois no menu /.', texto.replace(/\s+/g, ' ').slice(0, 40));
  if (!nome || !nome.trim()) return;
  const lista = (await window.api.promptsLer()) || [];
  const limpo = nome.trim().slice(0, 60);
  // mesmo nome de novo = ele esta CORRIGINDO o prompt, nao criando um segundo igual
  const semIgual = lista.filter((p) => p.nome !== limpo);
  semIgual.unshift({ nome: limpo, texto, quando: Date.now() });
  const r = await window.api.promptsSalvar(semIgual);
  // R4: mensagem de sucesso por note() sem `true` nao aparece na tela. Sucesso vai por avisoTemp.
  if (r && r.ok) avisoTemp(P, 'Prompt “' + limpo + '” salvo. Aparece no menu / em “Prompts salvos”.');
  else note(P, 'Não consegui salvar: ' + ((r && r.error) || 'erro'), true);
}
async function apagarPromptSalvo(P) {
  const lista = (await window.api.promptsLer()) || [];
  if (!lista.length) { avisoTemp(P, 'Nenhum prompt salvo ainda.'); return; }
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Apagar prompt salvo', 'Clique no que quer apagar.'));
  for (const p of lista) m.appendChild(elItem({ ic: 'eraser', nome: p.nome, desc: String(p.texto || '').replace(/\s+/g, ' ').slice(0, 80) }, async () => {
    const r = await window.api.promptsSalvar(lista.filter((x) => x !== p));
    if (r && r.ok) avisoTemp(P, 'Prompt “' + p.nome + '” apagado.');
    else note(P, 'Não consegui apagar: ' + ((r && r.error) || 'erro'), true);
  }));
}

/* ================== ENTRADA VISUAL (leva 4) ==================
   Outras portas alem de digitar: recortar um pedaco da tela, fotografar pela camera e tirar
   o texto de dentro de uma imagem. Tudo local; o que vira imagem cai em colados/, na mesma
   faxina de 7 dias do print colado. */

/* ---- recortar a tela: esconde o Cockpit e voce arrasta o pedaco ---- */
async function recortarTela(P) {
  fecharMenus();
  let r = null;
  try { r = await window.api.recortarTela({ paneId: P.id }); } catch (e) { r = { error: String(e && e.message || e) }; }
  // o sucesso nao volta por aqui: o recorte chega depois, pelo evento 'anexo-pronto'
  if (r && r.error) note(P, 'Não consegui recortar: ' + r.error, true);
}

/* ---- foto pela camera: rascunho no papel, quadro fisico, o que estiver na sua frente ---- */
async function fotografar(P) {
  fecharMenus();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    note(P, window.SEM_ELECTRON
      ? 'O navegador do celular só abre a câmera por endereço seguro (https). Tire a foto pelo Mac.'
      : 'Este computador não deixa abrir a câmera por aqui.', true);
    return;
  }
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  /* Sem estas duas linhas o painel que ja abriu a Conta do Codex fica marcado 'account' para
     sempre, e um evento rotineiro de conta trocaria o innerHTML NO MEIO — a camera ficaria
     acesa atras de outra janelinha. */
  modal.classList.remove('como-menu');
  modal.dataset.codexSurface = '';
  cx.className = 'modal-cx foto-cx';
  cx.onclick = (e) => e.stopPropagation();
  // a explicacao fica no balao do titulo: na tela, so o rotulo (redesenho 25/09)
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit" title="Enquadre e clique em Tirar. A foto entra como anexo deste painel.">Fotografar</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<video class="foto-video" autoplay playsinline muted></video>'
    + '<div class="mo-form"><select id="fotoCam" class="menu-search hidden"></select></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="fotoTirar">Tirar</button>'
    + '<button class="mo-btn" id="fotoCancela">Cancelar</button></div>';
  const video = $('.foto-video', cx);
  let trilha = null, fechado = false, vigia = 0;
  const parar = () => { try { trilha && trilha.getTracks().forEach((t) => t.stop()); } catch {} trilha = null; };
  const fechar = () => {
    if (fechado) return;
    fechado = true;
    clearInterval(vigia);
    parar();
    try { video.srcObject = null; } catch {}
    P.fecharTerminal = null;     // evita voltar aqui pelo fecharModal, em circulo
    cx.className = 'modal-cx';   // R9: sem isto a proxima janelinha deste painel sai deformada
    fecharModal(P);
  };
  // o UNICO gancho de fechamento que o Esc do documento respeita (e o ⌘W e o clique no véu)
  P.fecharTerminal = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); };
  $('.mo-x', cx).onclick = fechar;
  $('#fotoCancela', cx).onclick = fechar;
  /* Vigia. Se a janelinha for trocada por outra coisa sem passar por aqui, o <video> some da
     tela e a LUZ DA CÂMERA ficaria acesa sem nada na tela para desligar. Aqui a camera morre,
     mas a janela que estiver na tela AGORA nao e fechada — ela ja e' de outro dono. */
  vigia = setInterval(() => {
    if (video.isConnected) return;
    clearInterval(vigia);
    fechado = true;
    parar();
    if (P.fecharTerminal === fechar) P.fecharTerminal = null;
  }, 1000);

  const abrir = async (deviceId) => {
    parar();
    try {
      const nova = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      // a caixa fechou enquanto a camera acordava: a trilha atrasada morre aqui mesmo
      if (fechado) { try { nova.getTracks().forEach((t) => t.stop()); } catch {} return; }
      trilha = nova; video.srcObject = trilha;
    } catch (err) {
      if (fechado) return;
      const nome = (err && err.name) || '';
      // a camera lembrada sumiu (o celular foi desconectado): esquece a preferencia e cai na padrao
      if (deviceId && (nome === 'OverconstrainedError' || nome === 'NotFoundError' || nome === 'NotReadableError')) {
        // "em uso" e' passageiro: a preferencia fica
        if (nome !== 'NotReadableError') { cfg.cameraPreferida = ''; window.api.setConfig(cfg); }
        return abrir(null);
      }
      fechar();
      note(P, nome === 'NotAllowedError' ? 'O Mac não deixou usar a câmera. Libere em Ajustes do Sistema › Privacidade e Segurança › Câmera e abra o Cockpit de novo.'
        : nome === 'NotFoundError' ? 'Nenhuma câmera encontrada.'
        : nome === 'NotReadableError' ? 'A câmera está em uso por outro programa.'
        : 'Não consegui abrir a câmera' + (nome ? ' (' + nome + ')' : '') + '.', true);
    }
  };
  await abrir(cfg.cameraPreferida || null);
  if (!trilha || fechado) return;
  // a lista de camaras so aparece quando ha mais de uma (celular ligado como camera, webcam externa)
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const sel = $('#fotoCam', cx);
    if (sel) {
      sel.innerHTML = '';
      for (const d of devs) {
        const o = document.createElement('option');
        o.value = d.deviceId; o.textContent = d.label || 'Câmera';
        if (d.deviceId === cfg.cameraPreferida) o.selected = true;
        sel.appendChild(o);
      }
      sel.classList.toggle('hidden', devs.length < 2);
      sel.addEventListener('change', () => { cfg.cameraPreferida = sel.value; window.api.setConfig(cfg); abrir(sel.value); });
    }
  } catch {}
  const bt = $('#fotoTirar', cx);
  if (bt) bt.onclick = async () => {
    if (!video.videoWidth) { avisoTemp(P, 'A câmera ainda está acordando. Tente de novo em um segundo.'); return; }
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const dados = c.toDataURL('image/jpeg', 0.92);
    fechar();   // a luz da camera apaga ANTES de gravar: gravar pode demorar
    const r = await window.api.imagemSalvar({ dados, prefixo: 'foto' });
    // R4: sucesso por avisoTemp; note() sem `true` nao apareceria na tela
    if (r && r.arquivo) { await anexar(P, [r.arquivo]); avisoTemp(P, 'Foto anexada. Escreva o que quer que ele faça.'); }
    else note(P, 'Não consegui guardar a foto: ' + ((r && r.error) || 'erro'), true);
  };
}

/* ---- OCR: o texto que está DENTRO da imagem vai para o campo, editável ---- */
async function extrairTexto(P, a, bt) {
  if (a._ocr) return;   // ja esta lendo (a ficha pode ter sido repintada no meio)
  a._ocr = true;
  const antes = bt ? bt.textContent : '';
  if (bt) { bt.textContent = 'lendo…'; bt.disabled = true; }
  let r = null;
  try { r = await window.api.ocrLer({ arquivo: a.path }); } catch (e) { r = { error: String(e && e.message || e) }; }
  a._ocr = false;
  // ele pode ter removido o anexo enquanto o OCR ainda rodava: aí o texto não é mais dele
  const aindaAnexado = (P.anexos || []).includes(a);
  if (bt && bt.isConnected) { bt.textContent = antes; bt.disabled = false; }
  // a barra foi repintada no meio da leitura: o botao novo nasceu preso em "lendo…"
  else if (aindaAnexado) pintarAnexos(P);
  // R4: sucesso por avisoTemp; o note() so serve para o erro, e com `true`
  if (r && r.texto) {
    if (aindaAnexado) { inserirNoInput(P, r.texto); avisoTemp(P, 'Texto da imagem colocado no campo. Confira antes de mandar.'); }
    else avisoTemp(P, 'A imagem foi removida antes de terminar de ler; o texto não foi inserido.');
  }
  else note(P, 'Não achei texto nessa imagem' + (r && r.error ? ': ' + r.error : '.'), true);
}

/* ---- janelinha de conectores, no meio da conversa ---- */
const nomeLimpo = (n) => String(n || '').replace(/^claude\.ai\s+/i, '').replace(/^mcp[-_ ]/i, '').trim();

function fecharModal(P) {
  // se havia um terminal aberto nesta janelinha, encerrar o processo antes de fechar
  if (P && P.fecharTerminal) { const f = P.fecharTerminal; P.fecharTerminal = null; f(); return; }
  const m = $('.p-modal', P.el);
  m.classList.add('hidden'); $('.modal-cx', m).innerHTML = '';
  /* R9 de novo: a Conta (cx-conta) e a Configuração (cx-config) carimbam o tamanho e escondem o
     × — quem abrisse depois sem carimbar (os conectores) herdaria. Fechou, volta ao normal. */
  $('.modal-cx', m).className = 'modal-cx';
}

async function janelaConectores(P) {
  fecharMenus();
  const modal = $('.p-modal', P.el);
  const cx = $('.modal-cx', modal);
  cx.className = 'modal-cx';   // R9: aberta por cima da Conta ou da Configuração, não herda o carimbo delas
  modal.classList.remove('hidden');
  modal.dataset.codexSurface = 'connectors';
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.onclick = (e) => e.stopPropagation();

  const motor = nomeDoMotor(P.engine);
  const cabeca = () =>
    // a explicacao fica no balao do titulo: na tela, so o rotulo (redesenho 25/09)
    '<div class="mo-top"><span class="mo-tit" title="Serviços ligados ao ' + motor + ' neste Mac.">Conectores</span><button class="mo-x">' + ico('x') + '</button></div>';

  cx.innerHTML = cabeca() + '<div class="mo-carregando">Verificando conectores…</div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);

  /* Linhas NOVAS: no Codex sao DUAS coisas diferentes na mesma tela — os Apps do ChatGPT (que
     vivem na CONTA e valem em qualquer computador) e os conectores MCP que rodam aqui no Mac.
     O pedido sai ANTES do await de baixo, mas NAO e esperado aqui: medido nesta maquina, o
     catalogo de Apps leva 15 segundos e sao 3.563 itens. Esperar por ele deixaria a janelinha
     inteira presa em "Verificando conectores...". Quando chegar, o bloco se encaixa sozinho —
     se ainda for esta janelinha, e' o que a marca abaixo confere. */
  const marcaApps = 'ap' + Date.now() + Math.random();
  cx.dataset.geracaoApps = marcaApps;
  const pedidoApps = (P.engine === 'codex' && window.api.codexApps)
    ? lerAppsDoChatGpt() : Promise.resolve(null);
  /* o encaixe e' pedido DEPOIS de a janelinha ja ter se pintado, senao o innerHTML de baixo
     apagaria o bloco recem-encaixado quando a resposta vier do cache (instantanea) */
  const encaixarApps = (appsR) => {
    if (!appsR || cx.dataset.geracaoApps !== marcaApps) return;   // a janelinha virou outra coisa
    if (modal.classList.contains('hidden') || modal.dataset.codexSurface !== 'connectors') return;
    encaixarAppsDoChatGpt(cx, appsR);
  };
  const lista = await window.api.mcpList(P.engine);
  if (!modal || modal.classList.contains('hidden')) return;

  if (lista && lista.error) {
    cx.innerHTML = cabeca() + '<div class="mo-erro">' + lista.error + '</div>';
    cx.dataset.geracaoApps = marcaApps;   // o innerHTML apaga os filhos, nao o dataset; reafirma
    $('.mo-x', cx).onclick = () => fecharModal(P);
    // o erro dos conectores locais nao pode apagar os Apps, que podem ter carregado bem
    pedidoApps.then(encaixarApps);
    return;
  }

  const pintar = (arr) => {
    const linhas = arr.map((c, i) => {
      const classe = c.precisaEntrar ? 'falta' : (c.ligado ? 'ok' : 'off');
      return '<div class="co" data-i="' + i + '">'
        + '<span class="co-pt ' + classe + '"></span>'
        + '<span class="co-txt"><span class="co-n"></span><span class="co-s"></span></span>'
        + '<button class="co-bt ' + (c.precisaEntrar ? 'destaque' : 'some') + '" data-ac="login">'
        + (c.precisaEntrar ? 'Entrar' : 'Reconectar') + '</button>'
        + '<button class="co-bt some" data-ac="remove">Tirar</button>'
        + '</div>';
    }).join('');
    cx.innerHTML = cabeca()
      + '<div class="mo-lista">' + (linhas || '<div class="mo-carregando">Nenhum conector ainda.</div>') + '</div>'
      + '<div class="mo-rodape"><button class="mo-btn destaque" id="btAdd">Adicionar conector</button>'
      + '<button class="mo-btn" id="btRe">Atualizar</button></div>';
    $('.mo-x', cx).onclick = () => fecharModal(P);
    /* ":not(.ap)" e essencial: as linhas dos Apps tambem sao ".co", e o data-i delas conta
       outra lista. Sem isto o "Tirar" de um App tiraria o conector MCP errado. Hoje elas ainda
       nao existem neste ponto (entram logo abaixo, depois deste laco), mas a trava fica. */
    $$('.co:not(.ap)', cx).forEach((el) => {
      const c = arr[Number(el.dataset.i)];
      $('.co-n', el).textContent = nomeLimpo(c.nome);
      $('.co-s', el).textContent = c.precisaEntrar ? 'precisa entrar' : c.status;
      el.title = c.nome + (c.alvo ? '\n' + c.alvo : '');
      $$('.co-bt', el).forEach(bt => bt.onclick = async () => {
        const ac = bt.dataset.ac;
        if (ac === 'remove' && !confirm('Tirar o conector "' + c.nome + '" do ' + motor + '?')) return;
        // clique duplo aqui mandava dois mcpAcao juntos e abria DOIS terminais pro mesmo
        // login, um deles orfao: trava o botao ate a resposta voltar
        if (bt.disabled) return;
        bt.disabled = true;
        bt.textContent = '…';
        const r = await window.api.mcpAcao({ engine: P.engine, acao: ac, nome: c.nome });
        if (r && r.error) { bt.disabled = false; bt.textContent = 'erro'; alert(r.error); return; }
        if (r && r.terminal) janelaTerminal(P, r.terminal, r.titulo || nomeLimpo(c.nome), () => janelaConectores(P));
        else janelaConectores(P);
      });
    });
    $('#btRe', cx).onclick = () => janelaConectores(P);
    $('#btAdd', cx).onclick = () => formConector(P);
  };
  pintar(lista || []);
  cx.dataset.geracaoApps = marcaApps;   // o innerHTML do pintar apaga os filhos, nao o dataset
  pedidoApps.then(encaixarApps);
}

/* texto de fora (nome de App, recado de erro da API) nunca entra cru no HTML */
function escHtml(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* O catalogo de Apps e' o mesmo para a conta inteira e demora ~15s para voltar (sao milhares).
   Guardar por um minuto evita que cada repinte da janelinha — e ela repinta sozinha a cada
   aviso de conector do Codex — pague de novo essa espera. */
const APPS_VALE = 60000;
let appsGuardados = { quando: 0, dados: null, emVoo: null };
function lerAppsDoChatGpt() {
  if (appsGuardados.dados && Date.now() - appsGuardados.quando < APPS_VALE) return Promise.resolve(appsGuardados.dados);
  if (appsGuardados.emVoo) return appsGuardados.emVoo;   // duas janelinhas abertas nao pedem duas vezes
  appsGuardados.emVoo = window.api.codexApps()
    .then((r) => { appsGuardados = { quando: Date.now(), dados: r || null, emVoo: null }; return r || null; })
    .catch(() => { appsGuardados.emVoo = null; return null; });
  return appsGuardados.emVoo;
}

/* Bloco NOVO da janelinha de conectores: os Apps do ChatGPT.
   Entra por DOM, DEPOIS de a janelinha ja ter se pintado, e nao dentro do innerHTML dela — de
   proposito. Assim a janelaConectores continua a mesma (inclusive o dataset.codexSurface, que
   e quem faz o repinte automatico funcionar), e as linhas dos Apps nascem depois do laco que
   liga os botoes dos MCP: o data-i de uma lista nunca alcanca a outra. */
function encaixarAppsDoChatGpt(cx, appsR) {
  if (!appsR || !cx) return;                    // painel do Claude, ou a ponte nem existe
  $$('.ap-bloco', cx).forEach((n) => n.remove());   // repinte nao empilha dois blocos
  const todos = Array.isArray(appsR.apps) ? appsR.apps : [];
  /* Medido nesta conta: 3.563 Apps, e 3.550 deles vem "Indisponível nesta conta" — sem botao,
     sem acao, nada que ele possa fazer. Despejar isso na janelinha seria um paredao cinza de
     3.550 linhas escondendo as 13 que importam. Aqui ficam as que significam alguma coisa
     (liberadas na conta ou ja instaladas aqui) e o resto vira UMA frase, sem esconder o total. */
  const apps = todos.filter((a) => a.acessivel || a.instalado).slice(0, 60);
  const deFora = todos.length - apps.length;
  const cabecaApps = '<div class="mo-sec ap-bloco">Apps do ChatGPT<span class="mo-sec-d">valem na sua conta, em qualquer computador</span></div>';
  let miolo;
  if (appsR.error) miolo = '<div class="mo-erro ap-bloco">' + escHtml(appsR.error) + '</div>';
  else if (!apps.length) miolo = '<div class="mo-carregando ap-bloco">Nenhum App ligado nesta conta.</div>';
  else {
    const linhas = apps.map((a, i) => {
      /* amarelo e "precisa de voce" (a lista de MCP usa a mesma cor para "precisa entrar"):
         App desligado de proposito, ou ligado sem ferramenta nenhuma, e cinza, com o texto
         explicando — nao e problema dele para resolver. */
      return '<div class="co ap" data-i="' + i + '" title="' + escHtml(a.desc || a.nome) + '">'
        + '<span class="co-pt ' + (a.chamavel ? 'ok' : 'off') + '"></span>'
        + '<span class="co-txt"><span class="co-n">' + escHtml(a.nome) + '</span>'
        + '<span class="co-s">' + escHtml(a.status) + '</span></span>'
        // sem acesso na conta, "Instalar" so levaria a uma pagina que nao resolve
        + ((a.acessivel && !a.instalado && a.installUrl) ? '<button class="co-bt destaque">Instalar</button>' : '')
        + '</div>';
    }).join('');
    miolo = (appsR.aviso ? '<div class="mo-dica ap-bloco">' + escHtml(appsR.aviso) + '</div>' : '')
      + '<div class="mo-lista ap-bloco">' + linhas + '</div>'
      + (deFora > 0 ? '<div class="mo-dica ap-bloco">Outros ' + deFora
          + ' Apps existem no catálogo do ChatGPT, mas não estão liberados nesta conta.</div>' : '');
  }
  const caixa = document.createElement('div');
  caixa.innerHTML = cabecaApps + miolo
    + '<div class="mo-sec ap-bloco">Conectores deste Mac<span class="mo-sec-d">MCP instalados aqui</span></div>';
  $$('.co.ap', caixa).forEach((el) => {
    const a = apps[Number(el.dataset.i)];
    const bt = a && $('.co-bt', el);
    if (bt) bt.onclick = () => window.api.abrirLink(a.installUrl);
  });
  // o alvo tem de ser lido ANTES de encaixar, senao o .mo-lista dos Apps viraria o alvo
  const alvo = $('.mo-lista', cx) || $('.mo-erro', cx) || $('.mo-rodape', cx);
  while (caixa.firstChild) {
    const n = caixa.firstChild;
    if (alvo) cx.insertBefore(n, alvo); else cx.appendChild(n);
  }
}

function formConector(P) {
  const cx = $('.p-modal .modal-cx', P.el);
  const motor = nomeDoMotor(P.engine);
  cx.innerHTML =
    // a explicacao fica no balao do titulo: na tela, so o rotulo (redesenho 25/09)
    '<div class="mo-top"><span class="mo-tit" title="Cole o endereço que o serviço te deu. Se for um programa que roda aqui no Mac, use o campo de baixo.">Adicionar conector</span><button class="mo-x">' + ico('x') + '</button></div>'
    + '<div class="mo-form">'
    + '<input id="cnNome" placeholder="Nome curto, ex: notion">'
    + '<input id="cnUrl" placeholder="Endereço, ex: https://mcp.notion.com/mcp">'
    + '<div class="mo-dica">ou um programa local</div>'
    + '<input id="cnCmd" placeholder="Comando, ex: npx -y @alguem/mcp-server">'
    + '</div>'
    + '<div class="mo-erro" id="cnErro" style="display:none"></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="cnOk">Adicionar no ' + motor + '</button>'
    + '<button class="mo-btn" id="cnVolta">Voltar</button></div>';
  $('.mo-x', cx).onclick = () => fecharModal(P);
  $('#cnVolta', cx).onclick = () => janelaConectores(P);
  setTimeout(() => $('#cnNome', cx).focus(), 40);
  $('#cnOk', cx).onclick = async () => {
    const nome = $('#cnNome', cx).value.trim();
    const url = $('#cnUrl', cx).value.trim();
    const comando = $('#cnCmd', cx).value.trim();
    const erro = $('#cnErro', cx);
    if (!nome || (!url && !comando)) { erro.style.display = 'block'; erro.textContent = 'Preciso do nome e do endereço (ou do comando).'; return; }
    // mesma trava do botao "Entrar/Reconectar": sem isso, clique duplo aqui mandava dois
    // mcpAcao juntos e podia duplicar o conector ou colidir escrevendo no mesmo config
    const bt = $('#cnOk', cx);
    if (bt.disabled) return;
    bt.disabled = true;
    bt.textContent = 'adicionando…';
    const r = await window.api.mcpAcao({ engine: P.engine, acao: 'add', nome, url, comando });
    if (r && r.error) { erro.style.display = 'block'; erro.textContent = r.error; bt.textContent = 'Tentar de novo'; bt.disabled = false; return; }
    fecharModal(P);
    // aplicar o conector desliga o motor AGORA: com trabalho rodando, pergunta antes
    // (mesmo padrao de trocar de motor e trocar de modo), em vez de matar sem avisar
    const estavaRodando = !!P.busy || agTrabalhando(P);
    if (!confirmarCorte(P, 'Adicionar conector')) {
      avisoTemp(P, 'Conector "' + nome + '" adicionado. Vale quando este painel reiniciar (fim do turno atual ou próxima troca de motor).');
      return;
    }
    await desligarMotor(P);
    avisoTemp(P, 'Conector "' + nome + '" adicionado.' + (estavaRodando ? ' O que estava em andamento parou aqui.' : ''));
  };
}

/* ---- terminal embutido: roda o comando aqui dentro, sem abrir o Terminal do Mac ---- */
let termSeq = 0;
const termsVivos = new Map();
const REG_LINK = /https?:\/\/[^\s"'<>)\]]+/g;
/* O CLI escreve o link como "hyperlink de terminal" (OSC 8): o endereco vem DUAS vezes,
   coladinho, com codigos de escape no meio. Sem limpar isso, o que a gente pescava era um
   endereco grudado no outro — link quebrado. */
const semEscapes = (s) => s
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ' ')
  .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ')
  .replace(/\x1b[@-Z\\-_]/g, ' ');

window.api.onTermEvent(({ id, kind, data, code }) => {
  const t = termsVivos.get(id);
  if (!t) return;
  if (kind === 'data') { t.term.write(data); t.viu(data); }
  if (kind === 'exit') {
    t.vivo = false;
    t.term.write('\r\n\x1b[90m— terminou' + (code ? ' (código ' + code + ')' : ', tudo certo') + ' —\x1b[0m\r\n');
    if (t.acabou) t.acabou();
  }
});

/* Terminal embutido entrando na VPS. A linha do ssh e montada no MAIN (host e usuario moram
   no SERVIDORES de la); aqui so se pede e se abre a mesma janelinha de sempre. */
async function abrirTerminalVps(P) {
  if (!window.api.termLinhaShell) return avisoTemp(P, 'Este app ainda não sabe abrir o terminal da VPS.');
  const r = await window.api.termLinhaShell(P.cwd);
  if (!r || r.error || !r.linha) return avisoTemp(P, 'Não consegui montar o terminal da VPS: ' + ((r && r.error) || 'sem resposta'));
  janelaTerminal(P, r.linha, 'Terminal — ' + (r.titulo || 'VPS'));
}

function janelaTerminal(P, linha, titulo, aoFechar, opcoes) {
  const op = opcoes || {};
  // ja havia um terminal (ou outra janelinha larga) aberto NESTE painel (ex.: duplo clique em
  // "Entrar" nos conectores): fecha o antigo ANTES de montar o novo, senao o processo dele
  // fica rodando escondido para sempre — a unica forma de mata-lo era por P.fecharTerminal,
  // que estamos prestes a trocar. `.silencioso`: se o antigo tambem for um terminal, so mata
  // processo/limpa tela, sem chamar o aoFechar dele, que poderia reabrir por cima do novo.
  if (P.fecharTerminal) { const f = P.fecharTerminal; P.fecharTerminal = null; f.silencioso = true; try { f(); } catch {} }
  fecharMenus();
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  /* cx-terminal (alem do cx-term, que a janela larga do diff tambem usa): so o terminal ganha
     o fundo preto #0B0B0C nos dois temas, 760×460 (redesenho 25/09). */
  cx.className = 'modal-cx cx-term cx-terminal';
  cx.onclick = (e) => e.stopPropagation();

  const id = ESTA_TELA + 't' + (++termSeq);
  /* Barra de 39: icone + titulo + o comando em mono + parar (manda Ctrl+C) + ×. A frase de
     orientacao saiu da tela (regra dele: so rotulo) e virou o balao do icone e do titulo, sem
     (i) a mais na barra; o "Cancelar" de texto virou o quadradinho de parar, do tamanho do ×
     (a funcao e a mesma). O "Fechar" do rodape era o mesmo que o ×, e o rodape sumiu junto. */
  const orienta = op.orientacao || (op.abrirSozinho
    ? 'A entrada abre no navegador. Mantenha esta janela aberta até terminar lá. Se o navegador não abrir, clique em Abrir link aqui embaixo.'
    : 'Rodando aqui dentro do Cockpit. Se pedir para escolher ou colar algo, clique na tela preta e digite.');
  cx.innerHTML =
    '<div class="mo-top"><span class="term-ic">' + ico('terminal') + '</span><span class="mo-tit"></span>'
    + '<span class="term-cmd"></span><span class="mo-gap"></span>'
    + '<button class="term-cancela" id="tmCancela" title="Cancelar o que está rodando (⌃C)" aria-label="Cancelar">' + ico('square') + '</button>'
    + '<button class="mo-x" title="Fechar (⌘W)">' + ico('x') + '</button></div>'
    + '<div class="term-wrap"><div class="term-tela"></div></div>'
    + '<div class="term-link"><span class="mono"></span><button>Abrir link</button></div>';
  $('.mo-tit', cx).textContent = titulo || 'Terminal';
  for (const sel of ['.mo-tit', '.term-ic']) { const e = $(sel, cx); if (e) e.title = orienta; }
  const cmd = $('.term-cmd', cx);
  if (cmd) { cmd.textContent = String(linha || ''); cmd.title = String(linha || ''); }

  /* ---- o tamanho de verdade da caixa preta ----
     O terminal nascia preso em 92 colunas por 22 linhas escritas no codigo, e o programa la
     dentro acreditava nesse tamanho. Em painel estreito (dois ou tres chats lado a lado) a
     linha quebrava no lugar errado, e barra de progresso e tabela saiam tortas.
     Agora a conta sai do tamanho REAL da caixa. A fonte do terminal e monoespacada (toda
     letra tem a mesma largura), entao basta medir uma regua escondida com a mesma fonte. */
  /* 12,5/20 do redesenho (mono dentro do terminal). A entrelinha do xterm multiplica a ALTURA
     DA LETRA (≈15px nesta fonte), nao o tamanho dela: 20 / 15 ≈ 1,34. */
  const TERM_FONTE = 12.5, TERM_ENTRELINHA = 1.34;
  const tela = $('.term-tela', cx);
  // 'fixed' e so 10 letras de proposito: a regua nao pode empurrar nada nem criar barra de
  // rolagem na janelinha. Invisivel, mas com caixa — e por isso que da para medir.
  const regua = document.createElement('span');
  regua.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;visibility:hidden;'
    + 'white-space:pre;font:' + TERM_FONTE + 'px/normal ui-monospace, SFMono-Regular, Menlo, monospace';
  regua.textContent = 'WWWWWWWWWW';
  cx.appendChild(regua);
  const medirTerminal = () => {
    const letra = (regua.getBoundingClientRect().width / 10) || 7.2;
    const caixa = tela.getBoundingClientRect();
    // -2 px de folga: melhor sobrar um fio de tela do que o texto ser cortado na direita
    return {
      cols: Math.max(20, Math.min(400, Math.floor(((caixa.width || 660) - 2) / letra))),
      // a linha do xterm = altura natural da letra (a regua, com entrelinha normal) × entrelinha
      rows: Math.max(6, Math.min(200, Math.floor((caixa.height || 340) / (((regua.getBoundingClientRect().height) || TERM_FONTE * 1.2) * TERM_ENTRELINHA)))),
    };
  };
  const tam = medirTerminal();

  const term = new Terminal({
    cols: tam.cols, rows: tam.rows, fontSize: TERM_FONTE, lineHeight: TERM_ENTRELINHA,
    cursorBlink: true, scrollback: 4000,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    // o terminal e preto nos dois temas (#0B0B0C), com o texto em branco a 90% (redesenho 25/09)
    theme: { background: '#0B0B0C', foreground: '#E6E6E6', cursor: '#E6E6E6', cursorAccent: '#0B0B0C', selectionBackground: '#ffffff30' },
  });
  term.open(tela);

  /* O painel muda de largura o tempo todo (arrastar o divisor, fechar a barra lateral, girar o
     iPad) e quem esta rodando la dentro so sabe do tamanho novo se alguem contar. O canal
     term:resize ja existia no app e nunca era chamado por ninguem. */
  let medidaAtual = tam.cols + 'x' + tam.rows;
  const ajustarTerminal = () => {
    const m = medirTerminal();
    const chave = m.cols + 'x' + m.rows;
    if (chave === medidaAtual) return;
    medidaAtual = chave;
    try { term.resize(m.cols, m.rows); } catch (_) {}
    Promise.resolve(window.api.termResize({ id, cols: m.cols, rows: m.rows })).catch(() => {});
  };
  const olhoTerminal = new ResizeObserver(ajustarTerminal);
  olhoTerminal.observe(tela);
  term.onData((d) => window.api.termInput({ id, data: d }));

  const elLink = $('.term-link', cx), txtLink = $('.mono', elLink);
  const reg = {
    term, buf: '', vivo: true,
    /* O ■ de parar so vale enquanto o comando roda. Acabou (ou nem comecou), ele sai da barra e
       fica so o × — no desenho (E5) o terminal que terminou tem so o fechar. */
    acabou() { const b = $('#tmCancela', cx); if (b) b.classList.add('hidden'); },
    viu(d) {
      this.buf = (this.buf + d).slice(-8000);
      const achou = semEscapes(this.buf).match(REG_LINK);
      if (!achou) return;
      const limpos = achou.map(x => x.replace(/[.,;]+$/, ''));
      // o CLI imprime o endereco do servidorzinho local ANTES do link de entrar.
      // O que interessa e o de fora: localhost aqui so serve para o navegador voltar.
      const deFora = limpos.filter(x => !/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(x));
      const u = deFora.length ? deFora[deFora.length - 1] : limpos[limpos.length - 1];
      if (txtLink.textContent === u) return;
      txtLink.textContent = u; elLink.classList.add('ver');
      // Aqui o Cockpit TAMBEM abria o navegador. So que o `claude auth login` ja diz
      // "Opening browser to sign in..." e o `codex login` faz o mesmo: davam duas abas
      // iguais toda vez. Quem abre e o CLI; aqui fica so o botao, para quando ele falhar.
      if (op.abrirSozinho) elLink.classList.add('destaque');
    },
  };
  termsVivos.set(id, reg);
  $('button', elLink).onclick = () => window.api.openUrl(txtLink.textContent);

  const fechar = () => {
    P.fecharTerminal = null;              // evita voltar aqui pelo fecharModal
    window.api.termKill({ id });
    try { olhoTerminal.disconnect(); } catch {}
    try { regua.remove(); } catch {}
    try { term.dispose(); } catch {}
    termsVivos.delete(id);
    cx.className = 'modal-cx';
    // fechar.silencioso: um terminal NOVO esta assumindo este mesmo painel agora (marcado
    // pelo proprio janelaTerminal antes de chamar). Fechar o modal ou chamar aoFechar aqui
    // reabriria por cima do terminal novo que acabou de montar.
    if (fechar.silencioso) return;
    fecharModal(P);
    aoFechar && aoFechar();
  };
  // O Esc chamava fecharModal direto e pulava o termKill: a janela sumia da tela e o comando
  // continuava rodando escondido, para sempre. Agora o fecharModal sabe encerrar o terminal.
  P.fecharTerminal = fechar;
  modal.onclick = (e) => { if (e.target === modal) fechar(); };
  $('.mo-x', cx).onclick = fechar;
  $('#tmCancela', cx).onclick = () => { window.api.termInput({ id, data: '\x03' }); term.focus(); };

  window.api.termRun({ id, linha, cols: tam.cols, rows: tam.rows }).then((r) => {
    if (r && r.error) { term.write('\r\n\x1b[31m[não consegui rodar: ' + r.error + ']\x1b[0m\r\n'); reg.acabou(); }
  });
  setTimeout(() => term.focus(), 60);
}

/* Caixinha de UMA pergunta ("qual o nome?"), na janelinha do proprio painel. Mesmo molde do
   janelaTerminal: o .p-modal daqui e por painel, nao ha modal global.
   Devolve o que ele escreveu, ou null se desistiu — por Esc, pelo X, pelo Cancelar ou por
   clique no veu. Quem chamou SEMPRE recebe uma resposta: promessa pendurada para sempre e
   pior do que resposta vazia. */
function perguntarTexto(P, titulo, dica, inicial) {
  return new Promise((res) => {
    fecharMenus();
    const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
    modal.classList.remove('hidden');
    /* Sem estas duas linhas o painel que ja abriu a Conta do Codex fica marcado 'account'
       para sempre, e o evento rotineiro de conta trocaria o innerHTML NO MEIO da digitacao:
       o nome que ele estava escrevendo sumiria da tela sem explicacao. */
    modal.classList.remove('como-menu');
    modal.dataset.codexSurface = '';
    cx.className = 'modal-cx';
    cx.onclick = (e) => e.stopPropagation();
    cx.innerHTML = '<div class="mo-top"><span class="mo-tit"></span><button class="mo-x">' + ico('x') + '</button></div>'
      + '<div class="mo-form"><input id="pedirTextoInp" maxlength="120"></div>'
      + '<div class="mo-rodape"><button class="mo-btn destaque" id="pedirTextoOk">OK</button>'
      + '<button class="mo-btn" id="pedirTextoCancela">Cancelar</button></div>';
    $('.mo-tit', cx).textContent = titulo;
    /* a dica saiu da tela (redesenho 25/09: so rotulo): fica no balao do titulo e, com o
       campo vazio, como texto de exemplo dentro dele */
    $('.mo-tit', cx).title = dica || '';
    const inp = $('#pedirTextoInp', cx);
    if (dica) inp.placeholder = dica;
    inp.value = inicial || '';
    let feito = false;
    const fim = (v) => {
      if (feito) return;
      feito = true;
      P.fecharTerminal = null;      // evita voltar aqui pelo fecharModal, em circulo
      cx.className = 'modal-cx';
      fecharModal(P);
      res(v);
    };
    // o UNICO gancho de fechamento que o Esc do documento respeita (e o ⌘W e o clique no veu)
    P.fecharTerminal = () => fim(null);
    modal.onclick = (e) => { if (e.target === modal) fim(null); };
    $('.mo-x', cx).onclick = () => fim(null);
    $('#pedirTextoCancela', cx).onclick = () => fim(null);
    $('#pedirTextoOk', cx).onclick = () => fim(inp.value);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fim(inp.value); }
      /* R8: sem o stopPropagation o MESMO Esc fechava a caixinha aqui e subia para o
         tratador do documento, que — ja sem popup na tela — mandava parar o trabalho da
         IA. Um aperto, duas coisas, e a segunda invisivel. */
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fim(null); }
    });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });
}


/* ============ painel dos agentes (o fluxo, de cima para baixo) ============
   Quando ele solta um OS, liga o ultracode ou manda um workflow, o trabalho deixa de ser uma
   conversa e vira um TIME. Na tela isso saia como mais uma linha de "Executado N comandos" —
   do mesmo tamanho de um Read. Aqui o time aparece desenhado: o pedido em cima, a fase, os
   agentes daquela fase lado a lado, a proxima fase, e o fim embaixo.
   A fonte e o proprio motor: os avisos task_started / task_progress / task_updated /
   task_notification que o CLI ja manda e que o app jogava fora. Nada de ler arquivo no disco. */

const AG_FERR_PT = {
  Bash: 'rodando um comando', Read: 'lendo um arquivo', Write: 'escrevendo um arquivo',
  Edit: 'mexendo num arquivo', NotebookEdit: 'mexendo num notebook',
  Glob: 'procurando arquivos', Grep: 'procurando no código', LS: 'olhando a pasta',
  WebSearch: 'pesquisando na web', WebFetch: 'lendo uma página',
  Agent: 'chamando outro agente', Task: 'chamando outro agente', SendMessage: 'falando com outro agente',
  Workflow: 'tocando um workflow', Skill: 'usando uma skill', TodoWrite: 'organizando as tarefas',
  StructuredOutput: 'montando a resposta', TaskOutput: 'buscando o resultado',
  ToolSearch: 'procurando ferramenta', Monitor: 'ficando de olho', Artifact: 'publicando a página',
  ReportFindings: 'relatando o que achou', KillShell: 'encerrando um processo',
};
const AG_MCP_PT = {
  browser_navigate: 'abrindo uma página', browser_click: 'clicando na página',
  browser_type: 'digitando na página', browser_take_screenshot: 'tirando um print',
  browser_snapshot: 'lendo a página', browser_evaluate: 'mexendo na página',
  execute_sql: 'consultando o banco', search: 'buscando', query_corpus: 'buscando na memória',
};
const AG_AGENTE_PT = {
  'general-purpose': 'Pesquisador geral', Explore: 'Explorador', Plan: 'Arquiteto',
  claude: 'Assistente', 'workflow-subagent': 'Agente do workflow',
  'code-reviewer': 'Revisor de código', 'statusline-setup': 'Ajustes da barra',
};
/* O nome vem em ingles do motor. Traduzir aqui e barato e e o que faz o painel ser lido de
   relance; o que nao estiver no dicionario aparece com o nome de origem, entao ferramenta nova
   da Anthropic nunca quebra a tela — so aparece em ingles ate alguem traduzir. */
function agNomeFerramenta(n) {
  if (!n) return '';
  if (AG_FERR_PT[n]) return AG_FERR_PT[n];
  if (n.startsWith('mcp__')) {
    const p = n.split('__');
    const fim = p[p.length - 1] || '';
    if (AG_MCP_PT[fim]) return AG_MCP_PT[fim];
    return 'usando ' + (p[1] || 'um conector').replace(/^(plugin_|claude_ai_)/, '').replace(/_/g, ' ');
  }
  return n;
}
function agBonito(s) {
  return String(s || '').replace(/[-_:]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^./, (c) => c.toUpperCase());
}
function agNomeAgente(t) {
  return AG_AGENTE_PT[t] || agBonito(t);
}
// "1m 02s", o mesmo jeito do cartao do time na conversa e do resto do app (era "1min 2s")
function agTempo(ms) {
  if (!ms && ms !== 0) return '';
  return tempoCurto(ms);
}
/* O que o agente esta fazendo, no MESMO vocabulario dos passos da conversa ("Lendo",
   "Terminal", "Buscando"), com letra maiuscula: e o "fase" da linha do time no design
   ("Lendo · sobre.html", "Pronto · 12 imagens"). Ferramenta que os passos nao conhecem (um
   conector, uma ferramenta nova) cai no dicionario do painel ("Abrindo uma página"). */
const AG_VERBO_DO_PASSO = new Set(['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'TodoWrite', 'Skill']);
function agFazendo(est, ferramenta) {
  if (est === 'pronto') return 'Pronto';
  if (est === 'erro') return 'Deu erro';
  if (est === 'espera') return 'Na fila';
  if (!ferramenta) return 'Pensando';
  if (AG_VERBO_DO_PASSO.has(ferramenta)) return fraseCrua(ferramenta, '', '').txt;
  return agBonito(agNomeFerramenta(ferramenta)) || 'Pensando';
}
function agTokens(n) {
  if (!n) return '';
  return n >= 1000 ? Math.round(n / 1000) + 'k palavras-token' : n + ' palavras-token';
}

function agEstado(P) {
  if (!P.ag) P.ag = { tarefas: new Map(), ordem: [] };
  return P.ag;
}
// numa sessao longa (o chat nunca fecha, so acumula OS/workflow/ultracode ao longo de dias) a
// lista de tarefas do painel de agentes nunca era limpa: podar as mais VELHAS e ja TERMINADAS
// quando passa do teto, pra memoria e o tempo de repintura (a cada segundo) nao crescer pra sempre
const AG_TETO_TAREFAS = 300;
function agPodarTarefas(A) {
  while (A.ordem.length > AG_TETO_TAREFAS) {
    const maisVelha = A.ordem[0];
    const t = A.tarefas.get(maisVelha);
    // nunca remover tarefa ainda rodando: so as que ja chegaram no estado final
    if (!t || (!t.fim && !AG_FINAL.has(t.estado))) break;
    A.ordem.shift();
    A.tarefas.delete(maisVelha);
  }
}
/* Um evento do motor entra aqui e vira estado. A tela so e redesenhada se o painel estiver
   aberto — com o painel fechado isto custa quase nada, e por isso pode ficar sempre ligado. */
function agentesEvento(P, ev) {
  const A = agEstado(P);
  const pega = (id) => {
    let t = A.tarefas.get(id);
    if (!t) {
      t = { id, classe: '', desc: '', tipo: '', workflow: '', inicio: Date.now(), fim: 0,
        estado: 'rodando', ferramenta: '', resumo: '', uso: null, fases: [], agentes: new Map() };
      A.tarefas.set(id, t); A.ordem.push(id);
      agPodarTarefas(A);
    }
    return t;
  };
  if (ev.ev === 'inicio') {
    const t = pega(ev.id);
    t.classe = ev.classe || ''; t.desc = ev.desc || ''; t.tipo = ev.tipo || '';
    t.workflow = ev.workflow || ''; t.prompt = ev.prompt || ''; t.inicio = ev.em || Date.now();
    t.estado = 'rodando';
  } else if (ev.ev === 'andamento') {
    const t = pega(ev.id);
    if (ev.ferramenta) t.ferramenta = ev.ferramenta;
    if (ev.resumo) t.resumo = ev.resumo;
    if (ev.uso) t.uso = ev.uso;
    t.visto = ev.em || Date.now();
    // O fluxo do workflow as vezes vem vazio (o aviso e so de gasto). Vazio nao pode apagar o
    // que ja foi desenhado: mistura por indice, mantendo o que ja se sabia de cada agente.
    if (ev.fluxo && ev.fluxo.length) {
      const fases = [];
      for (const it of ev.fluxo) {
        if (it.type === 'workflow_phase') { fases.push({ i: it.index, titulo: it.title || '' }); continue; }
        if (it.type !== 'workflow_agent') continue;
        const ant = t.agentes.get(it.index) || {};
        // a hora em que ele apareceu pela primeira vez: e dai que sai o tempo correndo no cartao
        // enquanto o motor ainda nao mandou a duracao final
        if (!ant.desde) ant.desde = ev.em || Date.now();
        t.agentes.set(it.index, Object.assign({}, ant, {
          i: it.index, rotulo: it.label || ant.rotulo || '', fase: it.phaseTitle || ant.fase || '',
          faseI: it.phaseIndex || ant.faseI || 0, estado: it.state || ant.estado || 'espera',
          ferramenta: it.lastToolName || ant.ferramenta || '', detalhe: it.lastToolSummary || ant.detalhe || '',
          tokens: it.tokens || ant.tokens || 0, chamadas: it.toolCalls || ant.chamadas || 0,
          duracao: it.durationMs || ant.duracao || 0, agentId: it.agentId || ant.agentId || '',
          pedido: it.promptPreview || ant.pedido || '',
        }));
      }
      if (fases.length) t.fases = fases;
    }
  } else if (ev.ev === 'mudou') {
    const t = pega(ev.id);
    const p = ev.patch || {};
    if (p.status) t.estado = p.status === 'completed' ? 'pronto' : (p.status === 'killed' ? 'parado' : p.status);
    if (p.end_time) t.fim = p.end_time;
  } else if (ev.ev === 'fim') {
    const t = pega(ev.id);
    t.estado = ev.estado === 'completed' ? 'pronto' : (ev.estado === 'killed' ? 'parado' : 'erro');
    t.fim = ev.em || Date.now();
    if (ev.resumo) t.resumo = ev.resumo;
    if (ev.uso) t.uso = ev.uso;
  } else if (ev.ev === 'lista') {
    /* background_tasks_changed: a lista COMPLETA do que ainda roda em segundo plano (troca, não
       soma). É ela que diz quando o trabalho acabou de verdade. Entram só agentes e workflows:
       um servidor ligado em segundo plano (local_bash) não é trabalho e deixaria a aba piscando
       para sempre; e o CLI marca como `ambient` o que não deve contar como atividade. */
    const antes = A.vivos ? A.vivos.size : 0;
    A.vivos = new Set((ev.tarefas || [])
      .filter(t => t && t.task_id && !t.ambient && AG_TIPO_TRABALHO.test(t.task_type || ''))
      .map(t => t.task_id));
    // quando o último termina, o CLI costuma acordar o chat logo em seguida para ler o resultado:
    // uma folga curta evita a bolinha apagar e acender de novo nesse meio-tempo
    if (antes && !A.vivos.size) {
      A.folgaAte = Date.now() + 2500;
      setTimeout(() => agRepintarAba(P), 2600);
    }
  }
  pintarBotaoAgentes(P);
  agRepintarAba(P);
  agCartaoNaConversa(P, ev);
  if (agPaneAberto === P) agAgendarDesenho();
}

/* A bolinha amarela da aba lá em cima continua piscando enquanto houver agente ou workflow
   rodando, mesmo depois que o turno do chat acabou (aí o chat em si já não mostra nada). */
const AG_TIPO_TRABALHO = /agent|workflow|teammate/i;
const AG_FINAL = new Set(['pronto', 'parado', 'erro', 'failed', 'completed', 'killed', 'stopped']);
function agTrabalhando(P) {
  const A = P && P.ag; if (!A) return false;
  // o Claude manda a lista oficial; o Codex não, então ali vale o estado de cada tarefa
  if (A.vivos) return A.vivos.size > 0 || Date.now() < (A.folgaAte || 0);
  for (const t of A.tarefas.values())
    if (!t.fim && !AG_FINAL.has(t.estado) && AG_TIPO_TRABALHO.test(t.classe || 'agent')) return true;
  return false;
}
// só repinta a aba quando muda de verdade: os avisos de andamento chegam várias vezes por segundo
function agRepintarAba(P) {
  const trab = agTrabalhando(P);
  if (trab === !!P.agTrab) return;
  P.agTrab = trab;
  const Ab = abaDe(P); if (Ab) pintarAba(Ab);
}
// o motor caiu: o que rodava em segundo plano morreu com ele, então não pode seguir piscando
function agMotorCaiu(P) {
  const A = P && P.ag; if (!A) return;
  for (const t of A.tarefas.values()) if (!t.fim && !AG_FINAL.has(t.estado)) { t.estado = 'parado'; t.fim = Date.now(); }
  if (A.vivos) A.vivos.clear();
  A.folgaAte = 0;
  pintarBotaoAgentes(P);
  agRepintarAba(P);
}

// quantos estao trabalhando NESTE momento: e o numero que aparece grudado no botao
function agAtivos(P) {
  const A = P.ag; if (!A) return 0;
  let n = 0;
  for (const t of A.tarefas.values()) {
    if (t.estado !== 'rodando') continue;
    if (t.agentes.size) {
      for (const a of t.agentes.values()) if (a.estado === 'start' || a.estado === 'progress') n++;
    } else n++;
  }
  return n;
}
function agTotal(P) { return P.ag ? P.ag.tarefas.size : 0; }

function pintarBotaoAgentes(P) {
  const bt = $('.p-agentes', P.el); if (!bt) return;
  const vivos = agAtivos(P);
  const total = agTotal(P);
  bt.classList.toggle('vazio', total === 0);
  bt.classList.toggle('vivo', vivos > 0);
  const sel = $('.pa-n', bt);
  const n = vivos > 0 ? String(vivos) : (total ? String(total) : '');
  if (sel) sel.textContent = n;
  bt.classList.toggle('tem-n', !!n);
  bt.title = vivos > 0
    ? vivos + (vivos === 1 ? ' agente trabalhando agora' : ' agentes trabalhando agora') + ' — clique para ver o fluxo'
    : (total ? 'Ver o time de agentes deste chat' : 'O time de agentes aparece aqui quando você usa um OS ou liga o ultracode');
}

function criarBotaoAgentes(P, el) {
  const bt = document.createElement('button');
  bt.className = 'cb p-agentes vazio';
  bt.innerHTML = ico('agentes') + '<span class="pa-n"></span>';
  bt.addEventListener('click', (e) => { e.stopPropagation(); abrirPainelAgentes(P); });
  // fica do lado direito, junto do cerebro do modelo — e ali que ele olha quando quer saber
  // "com quem eu estou trabalhando agora", nao do lado dos botoes de escrever
  const modelo = $('.p-model', el);
  if (modelo) modelo.insertAdjacentElement('afterend', bt); else $('.cmp-bar', el).appendChild(bt);
  pintarBotaoAgentes(P);
}

/* O botao do quadro fica GRUDADO no cerebro, do lado ESQUERDO dele. Desenhar um fluxo e a
   quarta forma de dar entrada de informacao (falar, escrever, mandar print, desenhar), entao
   mora no canto das decisoes do painel — nao no meio dos botoes de escrever. */
function criarBotaoQuadro(P, el) {
  const bt = document.createElement('button');
  bt.className = 'cb p-quadro';
  bt.title = 'Desenhar um fluxo para explicar o que você quer (⌘⇧E)';
  bt.innerHTML = ico('quadro');
  bt.addEventListener('click', (e) => {
    e.stopPropagation();
    setFocus(P);
    if (window.Quadro) window.Quadro.abrir(P);
  });
  const modelo = $('.p-model', el);
  if (modelo) modelo.insertAdjacentElement('beforebegin', bt);
  else $('.cmp-bar', el).appendChild(bt);
}

/* Menu do "…" da caixa (painel com menos de 400 de largura: o CSS esconde os quatro botões e
   mostra o "…"). Cada item CLICA o botão escondido, então o que acontece é exatamente o mesmo
   de sempre — nenhuma regra nova de envio, plano, quadro ou time mora aqui. */
function menuMais(P) {
  const m = novoMenu(P);
  const bt = (s) => $(s, P.el);
  const envio = bt('.p-modoenvio');
  if (envio) m.appendChild(elItem({ ic: 'queue', nome: 'Modo de envio',
    tag: P.envio === 'entra' ? 'Entra' : 'Fila' }, () => envio.click()));
  const plano = bt('.p-plano');
  // o plano mora no Codex (collaborationMode) e nos outros no modo "Plano": quem diz se está
  // ligado é o próprio botão (.ligado), pintado por pintarPlano
  if (plano && !plano.classList.contains('hidden') && !plano.disabled)
    m.appendChild(elItem({ ic: 'clipboard-list', nome: 'Planejar antes de executar', on: plano.classList.contains('ligado') }, () => plano.click()));
  const quadro = bt('.p-quadro');
  if (quadro) m.appendChild(elItem({ ic: 'quadro', nome: 'Quadro branco', tag: '⌘⇧E' }, () => quadro.click()));
  const time = bt('.p-agentes');
  if (time) m.appendChild(elItem({ ic: 'agentes', nome: 'Time de agentes', tag: agTotal(P) ? String(agAtivos(P) || agTotal(P)) : '' }, () => time.click()));
}

/* ---- a janela ---- */
let agPaneAberto = null;
let agDesenhoPedido = false;
let agRelogio = null;
function agAgendarDesenho() {
  if (agDesenhoPedido) return;
  agDesenhoPedido = true;
  requestAnimationFrame(() => { agDesenhoPedido = false; agDesenhar(); });
}
function agCaixa() {
  let el = document.getElementById('agPainel');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'agPainel'; el.className = 'hidden';
  el.innerHTML = '<div class="ag-cx">'
    + '<div class="ag-top"><span class="ag-tit">Time de agentes</span>'
    + '<span class="ag-sub"></span><span class="ag-gap"></span><span class="ag-conta"></span>'
    + '<button class="ag-x" title="Fechar (Esc)">' + ico('x') + '</button></div>'
    + '<div class="ag-corpo"></div></div>';
  el.addEventListener('click', (e) => { if (e.target === el) fecharPainelAgentes(); });
  $('.ag-x', el).addEventListener('click', fecharPainelAgentes);
  document.body.appendChild(el);
  return el;
}
function abrirPainelAgentes(P) {
  agPaneAberto = P;
  const el = agCaixa();
  // A cor viva do painel era a do motor (laranja no Claude, azul no Codex). Desde o redesenho
  // (25/09) ela e o azul do sistema (--ag no style.css); o motor fica guardado em --motor, que
  // e o que um logo dentro do painel deve usar.
  el.style.setProperty('--motor', P.engine === 'codex' ? 'var(--codex)' : 'var(--claude)');
  el.classList.remove('hidden');
  agDesenhar();
  // o tempo de cada agente anda sozinho enquanto a janela esta aberta
  if (agRelogio) clearInterval(agRelogio);
  agRelogio = setInterval(() => { if (agPaneAberto) agDesenhar(); }, 1000);
}
function fecharPainelAgentes() {
  const el = document.getElementById('agPainel');
  if (el) el.classList.add('hidden');
  agPaneAberto = null;
  if (agRelogio) { clearInterval(agRelogio); agRelogio = null; }
}
function agPainelAberto() {
  const el = document.getElementById('agPainel');
  return !!(el && !el.classList.contains('hidden'));
}
// a gemea do quadro branco: quem manda e a classe hidden do #qdPainel, nao um metodo novo
function qdPainelAberto() {
  const el = document.getElementById('qdPainel');
  return !!(el && !el.classList.contains('hidden'));
}

// bloco de texto sem HTML: tudo que vem do motor entra por textContent, nunca por innerHTML
function agEl(classe, texto) {
  const d = document.createElement('div');
  d.className = classe;
  if (texto != null) d.textContent = texto;
  return d;
}
function agCartaoAgente(a, agora) {
  const est = a.estado === 'done' ? 'pronto'
    : a.estado === 'error' ? 'erro'
    : (a.estado === 'progress' || a.estado === 'start') ? 'agora' : 'espera';
  const c = agEl('ag-card ' + est);
  const topo = agEl('ag-card-top');
  topo.appendChild(agEl('ag-bola'));
  topo.appendChild(agEl('ag-nome', agBonito(a.rotulo) || 'Agente ' + a.i));
  c.appendChild(topo);
  const fazendo = agFazendo(est, a.ferramenta);
  c.appendChild(agEl('ag-fazendo', fazendo));
  if (a.detalhe && est !== 'espera') c.appendChild(agEl('ag-detalhe', a.detalhe));
  const pe = agEl('ag-pe');
  const dur = a.duracao || (est === 'agora' ? agora - (a.desde || agora) : 0);
  const bits = [];
  if (dur) bits.push(agTempo(dur));
  if (a.tokens) bits.push(agTokens(a.tokens));
  if (a.chamadas) bits.push(a.chamadas + (a.chamadas === 1 ? ' passo' : ' passos'));
  pe.textContent = bits.join(' · ');
  c.appendChild(pe);
  if (a.pedido) c.title = a.pedido.slice(0, 300);
  return c;
}
/* Mais de quatro agentes na mesma fase nao cabem numa linha so. Em vez de deixar o leque
   quebrar sozinho — o que fazia a segunda linha parecer OUTRA fase — os cartoes sao repartidos
   em fileiras de quatro, com um pedaco de tronco ligando uma fileira na outra. */
const AG_POR_FILA = 4;
function agGrupo(titulo, etiqueta, cartoes, estado) {
  const g = agEl('ag-grupo ' + (estado || ''));
  const fx = agEl('ag-fase');
  if (etiqueta) fx.appendChild(agEl('ag-fase-rot', etiqueta));
  fx.appendChild(agEl('ag-fase-tit', titulo));
  fx.appendChild(agEl('ag-fase-cont', cartoes.length + (cartoes.length === 1 ? ' agente' : ' agentes')));
  g.appendChild(fx);
  for (let i = 0; i < cartoes.length; i += AG_POR_FILA) {
    const fila = cartoes.slice(i, i + AG_POR_FILA);
    g.appendChild(agEl('ag-tronco'));
    const linha = agEl('ag-cards' + (fila.length > 1 ? ' varios' : ''));
    for (const c of fila) {
      const col = agEl('ag-col');
      col.appendChild(agEl('ag-perna'));
      col.appendChild(c);
      linha.appendChild(col);
    }
    g.appendChild(linha);
  }
  return g;
}
function agDesenhar() {
  const el = document.getElementById('agPainel'); if (!el || !agPaneAberto) return;
  const P = agPaneAberto;
  const corpo = $('.ag-corpo', el);
  const A = P.ag;
  const agora = Date.now();
  corpo.innerHTML = '';
  $('.ag-sub', el).textContent = nomePasta(P.cwd) + (P.titulo ? ' · ' + P.titulo.slice(0, 46) : '');

  const tarefas = A ? A.ordem.map(id => A.tarefas.get(id)).filter(Boolean) : [];
  // o placar do topo: quantos estao trabalhando, quantos ja entregaram, quantos deram errado
  let feitos = 0, ruins = 0;
  for (const t of tarefas) {
    if (t.agentes.size) {
      for (const a of t.agentes.values()) { if (a.estado === 'done') feitos++; else if (a.estado === 'error') ruins++; }
    } else if (t.estado === 'pronto') feitos++;
    else if (t.estado === 'erro') ruins++;
  }
  const placar = [];
  if (agAtivos(P)) placar.push(agAtivos(P) + ' trabalhando');
  if (feitos) placar.push(feitos + (feitos === 1 ? ' pronto' : ' prontos'));
  if (ruins) placar.push(ruins + (ruins === 1 ? ' com erro' : ' com erro'));
  $('.ag-conta', el).textContent = placar.join(' · ');

  if (!tarefas.length) {
    const v = agEl('ag-vazio');
    v.appendChild(agEl('ag-vazio-tit', 'Ninguém trabalhando aqui ainda'));
    // sem frase explicativa na tela (regra do design): a explicacao fica no title
    v.title = 'Quando você soltar um OS, ligar o ultracode ou pedir um workflow, o time aparece aqui: '
      + 'cada fase, cada agente e o que ele está fazendo naquele instante.';
    corpo.appendChild(v);
    return;
  }

  const fluxo = agEl('ag-fluxo');
  const inicio = agEl('ag-no ag-inicio');
  inicio.appendChild(agEl('ag-no-rot', 'O pedido'));
  inicio.appendChild(agEl('ag-no-txt', P.titulo || 'Esta conversa'));
  fluxo.appendChild(inicio);

  let vivo = false;
  const soltos = tarefas.filter(t => !t.agentes.size && t.classe === 'local_agent');
  /* Agente solto (a ferramenta Agent, sem workflow) vem logo depois do pedido, e nao no fim:
     ele nasce ANTES ou junto do workflow, e jogado la embaixo parecia uma etapa final. */
  if (soltos.length) {
    const cartoes = soltos.map(t => agCartaoAgente({
      i: 0, rotulo: t.desc || agNomeAgente(t.tipo), estado: t.estado === 'rodando' ? 'progress'
        : (t.estado === 'pronto' ? 'done' : (t.estado === 'parado' ? 'espera' : 'error')),
      ferramenta: t.ferramenta, detalhe: t.resumo,
      tokens: t.uso ? t.uso.total_tokens : 0, chamadas: t.uso ? t.uso.tool_uses : 0,
      duracao: t.uso ? t.uso.duration_ms : (t.fim ? t.fim - t.inicio : agora - t.inicio),
      pedido: t.prompt,
    }, agora));
    const rodando = soltos.some(t => t.estado === 'rodando');
    fluxo.appendChild(agEl('ag-liga' + (rodando ? ' viva' : ' feita')));
    fluxo.appendChild(agGrupo('Agentes lançados direto', 'Sem fase', cartoes, rodando ? 'rodando' : 'pronto'));
  }
  for (const t of tarefas) {
    if (t.estado === 'rodando') vivo = true;
    if (t.agentes.size) {
      // workflow: uma faixa por fase, com os agentes daquela fase lado a lado
      const lista = [...t.agentes.values()].sort((a, b) => a.i - b.i);
      const porFase = new Map();
      for (const a of lista) {
        const k = a.fase || 'Trabalho';
        if (!porFase.has(k)) porFase.set(k, []);
        porFase.get(k).push(a);
      }
      const cab = agEl('ag-titulo-bloco');
      cab.appendChild(agEl('ag-bloco-rot', 'Workflow'));
      cab.appendChild(agEl('ag-bloco-nome', agBonito(t.workflow) || t.desc || 'Time de agentes'));
      fluxo.appendChild(agEl('ag-liga'));
      fluxo.appendChild(cab);
      /* O caminho INTEIRO aparece desde o comeco: as fases que ainda nao chegaram entram
         tracejadas. Sem isso a tela mentia — parecia que o trabalho acabava na fase de agora. */
      const nomes = (t.fases.length ? t.fases.map(f => f.titulo) : [...porFase.keys()]);
      for (const k of porFase.keys()) if (!nomes.includes(k)) nomes.push(k);
      let n = 1;
      for (const fase of nomes) {
        const ags = porFase.get(fase) || [];
        const rodando = ags.some(a => a.estado === 'start' || a.estado === 'progress');
        const tudoPronto = ags.length && ags.every(a => a.estado === 'done');
        fluxo.appendChild(agEl('ag-liga' + (rodando ? ' viva' : (tudoPronto ? ' feita' : ''))));
        if (!ags.length) {
          const espera = agEl('ag-fase-futura');
          espera.appendChild(agEl('ag-fase-rot', 'Fase ' + n));
          espera.appendChild(agEl('ag-fase-tit', agBonito(fase)));
          espera.appendChild(agEl('ag-fase-cont', 'Ainda não começou'));
          fluxo.appendChild(espera);
        } else {
          fluxo.appendChild(agGrupo(agBonito(fase), 'Fase ' + n, ags.map(a => agCartaoAgente(a, agora)),
            rodando ? 'rodando' : (tudoPronto ? 'pronto' : '')));
        }
        n++;
      }
    }
  }

  fluxo.appendChild(agEl('ag-liga' + (vivo ? '' : ' feita')));
  const fim = agEl('ag-no ag-fim' + (vivo ? ' esperando' : ' ok'));
  const quantos = agAtivos(P);
  fim.appendChild(agEl('ag-no-rot', vivo ? 'Acontecendo agora' : 'Fim'));
  fim.appendChild(agEl('ag-no-txt', vivo
    ? (quantos ? quantos + (quantos === 1 ? ' agente trabalhando' : ' agentes trabalhando') : 'Começando')
    : 'Todo mundo terminou'));
  fluxo.appendChild(fim);
  corpo.appendChild(fluxo);
}


/* ---- Time de agentes DENTRO da conversa (redesenho de 26/09) ----
   O painel grande (#agPainel) continua sendo o mapa completo, fase por fase. Na conversa fica
   um cartao curto no lugar em que o time comecou a trabalhar: cabecalho de 30 ("Time de
   agentes" + "2 de 3") e uma linha de 40 por agente (sinal + nome + "o que faz · em que" +
   tempo). O clique abre o painel grande. So le o estado que o agentesEvento ja montou (P.ag):
   nao decide nada sobre os agentes. Um cartao por pedido: agente que nasce depois de uma
   mensagem nova dele abre outro cartao embaixo, em vez de mexer num la de cima. */
const AG_CARTAO_TETO = 8;           // mais que isso vira "+N agentes" (o resto esta no painel)
function agLinhasDoCartao(P, ids, agora) {
  const A = P.ag; const linhas = [];
  const fazendo = (est, ferramenta) => agFazendo(est, ferramenta);
  for (const id of ids) {
    const t = A && A.tarefas.get(id); if (!t) continue;
    if (t.agentes.size) {
      for (const a of [...t.agentes.values()].sort((x, y) => x.i - y.i)) {
        const est = a.estado === 'done' ? 'pronto' : a.estado === 'error' ? 'erro'
          : (a.estado === 'progress' || a.estado === 'start') ? 'agora' : 'espera';
        linhas.push({ est, nome: agBonito(a.rotulo) || 'Agente ' + a.i, fazendo: fazendo(est, a.ferramenta),
          em: a.detalhe || '', ms: a.duracao || (est === 'agora' ? agora - (a.desde || agora) : 0), dica: a.pedido || '' });
      }
    } else if (t.classe === 'local_agent') {
      const est = t.estado === 'rodando' ? 'agora' : t.estado === 'pronto' ? 'pronto' : t.estado === 'parado' ? 'espera' : 'erro';
      linhas.push({ est, nome: t.desc || agNomeAgente(t.tipo) || 'Agente', fazendo: fazendo(est, t.ferramenta),
        em: '', ms: t.uso && t.uso.duration_ms ? t.uso.duration_ms : (t.fim ? t.fim - t.inicio : agora - t.inicio), dica: t.prompt || '' });
    }
  }
  return linhas;
}
function agCartaoNaConversa(P, ev) {
  if (!P || !P.chat || !ev) return;
  let c = P.agCartao;
  /* o cartao de agora so vale enquanto nenhuma mensagem DELE veio depois dele. Cartao que
     ainda nao apareceu (so tarefa sem agente, como servidor em segundo plano) vale enquanto o
     turno em que nasceu nao acabou. */
  let vale = !!(c && (c.el ? c.el.isConnected : c.turno === P.t0));
  for (let n = vale && c.el ? c.el.nextElementSibling : null; vale && n; n = n.nextElementSibling)
    if (n.classList.contains('msg') && n.classList.contains('user')) vale = false;
  if (ev.ev === 'inicio') {
    if (!vale) { c = P.agCartao = { el: null, ids: new Set(), turno: P.t0 }; }
    c.ids.add(ev.id);
  } else if (!c || !c.ids.has(ev.id)) return;      // lista geral ou tarefa de um cartao antigo
  agPintarCartaoConversa(P);
}
function agPintarCartaoConversa(P) {
  const c = P.agCartao; if (!c) return;
  const agora = Date.now();
  const linhas = agLinhasDoCartao(P, c.ids, agora);
  if (!linhas.length) return;                       // so servidor em segundo plano: nao e time
  if (!c.el) {
    clearEmpty(P);
    c.el = document.createElement('div');
    c.el.className = 'equipe';
    c.el.setAttribute('role', 'button');
    c.el.tabIndex = 0;
    c.el.title = 'Ver o time de agentes inteiro';
    c.el.addEventListener('click', () => abrirPainelAgentes(P));
    c.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirPainelAgentes(P); } });
    P.chat.appendChild(c.el);
    if (P.trabEl) P.chat.appendChild(P.trabEl);
    scroll(P);
  }
  const ativos = linhas.filter(l => l.est === 'agora').length;
  const prontos = linhas.filter(l => l.est === 'pronto').length;
  // a linha do trabalhando le daqui o "Coordenando 3 agentes" (verboDoTrabalho)
  const mudouTime = c.ativos !== ativos || c.total !== linhas.length;
  c.ativos = ativos; c.total = linhas.length;
  if (mudouTime && P.trabEl) pintaTrab(P);
  const cab = document.createElement('div');
  cab.className = 'equipe-hd';
  cab.innerHTML = '<span class="equipe-ic">' + ico('team') + '</span><span class="equipe-tit">Time de agentes</span>'
    + '<span class="equipe-gap"></span><span class="equipe-conta"></span>';
  const conta = $('.equipe-conta', cab);
  conta.textContent = (ativos ? ativos : prontos) + ' de ' + linhas.length;
  conta.title = ativos ? ativos + ' trabalhando agora' : prontos + (prontos === 1 ? ' pronto' : ' prontos');
  const corpo = [cab];
  for (const l of linhas.slice(0, AG_CARTAO_TETO)) {
    const d = document.createElement('div');
    d.className = 'equipe-l ' + l.est;
    d.innerHTML = '<span class="equipe-sinal">' + (l.est === 'agora' ? '<span class="rd-anel"></span>'
        : l.est === 'pronto' ? ico('check') : l.est === 'erro' ? ico('warn') : '') + '</span>'
      + '<span class="equipe-txt"><span class="equipe-nome"></span><span class="equipe-fase"><span class="equipe-faz"></span>'
      + '<span class="equipe-em"></span></span></span><span class="equipe-tempo"></span>';
    $('.equipe-nome', d).textContent = l.nome;
    $('.equipe-faz', d).textContent = l.fazendo;
    const em = $('.equipe-em', d);
    if (l.em) em.textContent = l.em; else em.remove();
    $('.equipe-tempo', d).textContent = l.ms ? tempoCurto(l.ms) : '';
    if (l.dica) d.title = l.dica.slice(0, 300);
    corpo.push(d);
  }
  if (linhas.length > AG_CARTAO_TETO) {
    const mais = document.createElement('div');
    mais.className = 'equipe-mais';
    mais.textContent = '+' + (linhas.length - AG_CARTAO_TETO) + ' agentes';
    corpo.push(mais);
  }
  c.el.replaceChildren(...corpo);
  // o tempo de quem ainda trabalha anda sozinho; ninguem trabalhando, o relogio para
  if (ativos && !c.relogio) c.relogio = setInterval(() => {
    if (!c.el.isConnected || P.agCartao !== c) { clearInterval(c.relogio); c.relogio = null; return; }
    agPintarCartaoConversa(P);
  }, 1000);
  else if (!ativos && c.relogio) { clearInterval(c.relogio); c.relogio = null; }
}

/* ============ conta e limite fixos na barra lateral ============ */
const contaCache = { claude: null, codex: null, acp: null, gemini: null, grok: null };

/* O "Entrar" do cartao da conta chamava contaAcao(focusPane) — o motor do CHAT EM FOCO, nao o
   da IA do cartao. Com um chat do Codex em foco, clicar em "Entrar" no cartao do Claude rodava
   "codex login". O login e' sempre o do motor daquele cartao, e sem chat desse motor a tela
   diz isso em vez de errar calada. (Voltou em 25/09: a lista unica tinha perdido o Entrar.) */
function entrarNaConta(engine) {
  let P = (focusPane && focusPane.engine === engine)
    ? focusPane
    : [...panes.values()].find((q) => q.engine === engine);
  if (!P && ['gemini', 'grok'].includes(engine)) {
    P = focusPane || novoChatNaAba(engine);
  }
  if (P) { setFocus(P); contaAcao(P, 'login', engine); return; }
  const recado = 'Abra um chat do ' + nomeDoMotor(engine) + ' para entrar na conta dele.';
  if (focusPane) note(focusPane, recado, true);
}

/* ---- conta e uso do plano no topo da lista de conversas (25/09) ----
   Cada coluna de motor tinha a conta dela no topo. Na lista unica fica UM bloco curto por IA:
     - com login: logo + nome (ou e-mail) + plano, e embaixo Sessao e Semana quando houver
       numero (%, barra fina, "zera …"). Consulta segurada ou que falhou: so a linha da conta,
       e o porque vai no title. Clicar abre a janela da conta daquela IA.
     - sem login: logo + botao "Entrar", que roda o login do motor CERTO (entrarNaConta).
     - IA que nao esta instalada neste Mac: nao aparece.
   Sem frase na tela: o detalhe mora no title.
   O nome ficou pintarContaLateral porque o lerUso, o login e o trocar de conta ja chamam por
   ele quando o numero de um motor muda: continua sendo o jeito de repintar UM motor. */
const contaLidaEm = porMotor(0);
/* forcar = reler a conta agora (evento de conta do Codex, login, troca de conta): sempre rele.
   A trava de um minuto e so do ABRIR a vista (pintarUsoLateral), senao abrir e fechar a coluna
   viraria uma consulta de limite atras da outra (a Anthropic responde 429). */
async function pintarContaLateral(engine, forcar) {
  const cx = $('#cvUso');
  if (!cx || !MOTORES_VISIVEIS.includes(engine)) return;
  if (!contaCache[engine] || forcar) {
    contaLidaEm[engine] = Date.now();
    try { contaCache[engine] = await window.api.contaLer(engine); } catch { /* fica o que ja tinha */ }
  }
  pintarBlocoDeUso(cx, engine, contaCache[engine]);
}
function pintarUsoLateral(forcar) {
  for (const m of MOTORES_VISIVEIS) pintarContaLateral(m, !!forcar && Date.now() - contaLidaEm[m] > 60000);
}
function pintarBlocoDeUso(cx, engine, c) {
  let bloco = $('.cv-uso-motor[data-motor="' + engine + '"]', cx);
  // conta ainda nao lida, ou IA que nao esta instalada neste Mac: nada no topo
  if (!c || (MOTORES_OK && MOTORES_OK[engine] === false)) { if (bloco) bloco.remove(); return; }
  /* 26/09 (desenho novo): o reset sai na HORA em que zera ("zera 14:20", "zera seg 09:00"), como
     no desenho; quanto falta fica na dica. O aviso de limite em cima da caixa continua relativo. */
  const janela = (rotulo, j) => {
    if (!j) return '';
    const pct = Math.min(100, Math.max(0, Math.round(j.pct || 0)));
    return '<div class="cv-uso-janela"><div class="cv-uso-top"><span class="cv-uso-rot">' + rotulo + '</span>'
      + '<span class="cv-uso-pct">' + pct + '%</span>'
      + (j.reseta ? '<span class="cv-uso-zera"' + (j.reseta > Date.now() ? ' title="zera ' + escaparAtributo(quandoFuturo(j.reseta)) + '"' : '')
        + '>' + escaparAtributo(textoDoZera(j.reseta)) + '</span>' : '')
      + '</div><div class="cv-uso-barra"><span style="width:' + pct + '%"></span></div></div>';
  };
  const janelas = c.entrou ? janela('Sessão', c.sessao) + janela('Semana', c.semana) : '';
  /* 26/09: IA com login mas sem número de uso para mostrar (o Grok não tem; o Claude antes da
     primeira leitura ou com a consulta segurada) não ocupa linha: era um logo + nome solto entre
     as barras e a pasta, e os quatro blocos empurravam a lista para baixo. A conta dela continua
     no menu do chat (Conta). Sem login o bloco fica: o "Entrar" é o caminho para entrar. */
  if (c.entrou && !janelas) { if (bloco) bloco.remove(); return; }
  if (!bloco) {
    bloco = document.createElement('div');
    bloco.className = 'cv-uso-motor';
    bloco.dataset.motor = engine;
    // a ordem dos blocos e a dos motores, chegue a resposta de quem chegar primeiro
    const depois = MOTORES_VISIVEIS.slice(MOTORES_VISIVEIS.indexOf(engine) + 1)
      .map(m => $('.cv-uso-motor[data-motor="' + m + '"]', cx)).find(Boolean);
    cx.insertBefore(bloco, depois || null);
    // sem login o clique e so o do botao "Entrar"; com login, o bloco inteiro abre a conta
    bloco.addEventListener('click', () => { if (!bloco.classList.contains('sem-conta')) abrirContaDaLateral(engine); });
  }
  const motor = nomeDoMotor(engine);
  const logo = '<span class="cv-uso-logo">' + svgMotor(engine) + '</span>';
  if (!c.entrou) {
    bloco.classList.add('sem-conta');
    bloco.innerHTML = '<div class="cv-uso-cab">' + logo + '<button class="cv-uso-entrar">Entrar</button></div>';
    bloco.title = 'Sem conta do ' + motor + ' neste Mac';
    $('.cv-uso-entrar', bloco).onclick = (e) => { e.stopPropagation(); entrarNaConta(engine); };
    return;
  }
  bloco.classList.remove('sem-conta');
  bloco.innerHTML = '<div class="cv-uso-cab">' + logo + '<span class="cv-uso-nome"></span>'
    + (c.plano ? '<span class="cv-uso-plano"></span>' : '') + '</div>'
    + '<div class="cv-uso-janelas">' + janelas + '</div>';
  /* 26/09 (desenho novo): a linha diz QUAL IA é ("Claude", "Codex"), como o título da coluna do
     desenho; a conta (nome, e-mail) vai só na dica. Com o e-mail na tela, quatro linhas em
     negrito de endereço pareciam lista de contatos e não diziam de relance de qual IA era o uso. */
  $('.cv-uso-nome', bloco).textContent = motor;
  if (c.plano) $('.cv-uso-plano', bloco).textContent = c.plano;
  // número guardado de uma leitura antiga (a consulta de agora foi segurada): o quando vai no title
  const porque = c.velho ? 'Última leitura ' + haQuanto(c.velho) : '';
  const conta = [c.nome, c.email].filter((x, i, a) => x && a.indexOf(x) === i);
  bloco.title = [motor, c.plano, ...conta].filter(Boolean).join(' · ') + (porque ? '\n' + porque : '');
}
/* clicar no bloco abre a janela da conta daquela IA. A janelinha nasce DENTRO de um chat: tem
   de ser um que esteja na tela, senao o clique parece nao fazer nada. */
function abrirContaDaLateral(engine) {
  const naAba = abaAtiva ? abaAtiva.ordem.map(id => panes.get(id)).filter(Boolean) : [];
  const P = naAba.find(q => q.engine === engine) || (focusPane && naAba.includes(focusPane) ? focusPane : naAba[0])
         || [...panes.values()].find(q => q.engine === engine) || focusPane || panes.values().next().value;
  if (P) janelaConta(P, engine);
}

/* O 2o argumento diz de QUAL motor e a conta. Sem ele, clicar no cartao da conta do Claude
   na coluna da esquerda abria a conta do CODEX sempre que o chat em foco fosse do Codex. */
async function janelaConta(P, motorPedido) {
  fecharMenus();
  document.body.classList.remove('gaveta');
  const eng = motorPedido || P.engine;
  const modal = $('.p-modal', P.el), cx = $('.modal-cx', modal);
  modal.classList.remove('hidden');
  modal.dataset.codexSurface = eng === 'codex' ? 'account' : 'account-' + eng;
  modal.onclick = (e) => { if (e.target === modal) fecharModal(P); };
  cx.onclick = (e) => e.stopPropagation();
  /* Redesenho (25/09): sheet de 420 — logo + "Conta do X", a lista das contas em radio (a de
     agora marcada, as guardadas embaixo), e o rodape "Entrar com outra conta…" · Sair (vermelho,
     sem moldura) · Concluir. O uso detalhado (as barras, o "zera em") mora na coluna de
     Conversas; aqui fica o resumo na linha da conta e o resto no balao do mouse. */
  cx.className = 'modal-cx cx-conta';
  const motor = nomeDoMotor(eng);
  const topo = '<div class="mo-top"><span class="mo-logo" data-motor="' + eng + '"></span>'
    + '<span class="mo-tit">Conta do ' + motor + '</span>'
    + '<button class="mo-x" title="Fechar">' + ico('x') + '</button></div>';
  const pintarTopo = () => {
    const l = $('.mo-logo', cx); if (l) l.innerHTML = svgMotor(eng);
    $('.mo-x', cx).onclick = () => fecharModal(P);
  };
  cx.innerHTML = topo + '<div class="mo-carregando">Lendo a conta…</div>';
  pintarTopo();

  const c = await window.api.contaLer(eng);
  if (modal.classList.contains('hidden')) return;
  if (!c || !c.entrou) {
    cx.innerHTML = topo
      + '<div class="ct-lista"><div class="ct-linha"><span class="ct-radio"></span>'
      + '<span class="ct-txt"><span class="ct-n">Sem conta neste Mac</span></span></div></div>'
      + '<div class="mo-rodape"><button class="mo-btn" id="ctCodigo">Entrar com código…</button>'
      + '<span class="mo-gap"></span><button class="mo-btn destaque" id="ctEntrar">Entrar…</button></div>';
    pintarTopo();
    $('#ctEntrar', cx).onclick = () => { fecharModal(P); contaAcao(P, 'login', eng); };
    $('#ctCodigo', cx).onclick = () => { fecharModal(P); contaAcao(P, 'trocarCodigo', eng); };
    return;
  }

  // resumo da linha da conta: plano · sessão · semana (os numeros do limite, sem as barras)
  const pct = (j) => Math.min(100, Math.max(0, (j && j.pct) || 0)) + '%';
  const partes = [];
  if (c.plano) partes.push(String(c.plano).charAt(0).toUpperCase() + String(c.plano).slice(1));   // "max" → "Max"
  if (c.sessao) partes.push('sessão ' + pct(c.sessao));
  if (c.semana) partes.push('semana ' + pct(c.semana));
  if (!c.sessao && !c.semana) partes.push('limite indisponível');
  // o que antes era frase na tela (quando zera, leitura antiga, crédito extra) vai para o balão
  const balao = [c.nome && c.nome !== c.email ? c.nome : '', c.via || '',
    c.sessao && c.sessao.reseta ? 'Sessão zera ' + quandoFuturo(c.sessao.reseta) : (c.semSessao ? 'Sessão: sem limite neste plano' : ''),
    c.semana && c.semana.reseta ? 'Semana zera ' + quandoFuturo(c.semana.reseta) : '',
    (!c.sessao && !c.semana) ? (c.limitado
      ? 'O ' + motor + ' segurou as consultas agora. Tento de novo sozinho ' + (c.voltaEm ? quandoFuturo(c.voltaEm) : 'em alguns minutos') + '.'
      : 'Não consegui ler o limite agora.') : '',
    c.velho ? 'Última leitura ' + haQuanto(c.velho) + '.' : '',
    c.extra && c.extra.teto ? (c.extra.ligado ? 'Crédito extra ligado: ' + c.extra.usado + ' de ' + c.extra.teto + ' ' + c.extra.moeda : 'Crédito extra desligado') : '',
  ].filter(Boolean).join('\n');

  cx.innerHTML = topo
    + '<div class="ct-lista">'
    + '<div class="ct-linha on"><span class="ct-radio"></span><span class="ct-txt"><span class="ct-n"></span>'
    + '<span class="ct-e"></span></span><span class="ct-uso">Em uso</span></div>'
    + '</div>'
    + '<div class="ct-mais"></div>'
    + '<div class="mo-rodape">'
    + '<button class="mo-btn" id="ctTrocar">Entrar com outra conta…</button>'
    + '<span class="mo-gap"></span>'
    + '<button class="mo-btn perigo" id="ctSair">Sair</button>'
    + '<button class="mo-btn destaque" id="ctOk">Concluir</button></div>';
  pintarTopo();
  const lista = $('.ct-lista', cx);
  const atual = $('.ct-linha', lista);
  $('.ct-n', atual).textContent = c.email || c.nome || motor;
  $('.ct-e', atual).textContent = partes.join(' · ');
  atual.title = balao;
  /* código e a conta da VPS: botões sem moldura LOGO ABAIXO da lista. A lista em radio é só
     de contas (no desenho, E4); ação dentro dela parecia mais uma conta para escolher. */
  const mais = $('.ct-mais', cx);
  const acao = (icone, txt, fn) => {
    const b = document.createElement('button');
    b.className = 'ct-acao';
    b.innerHTML = ico(icone) + '<span></span>';
    $('span', b).textContent = txt;
    b.onclick = fn;
    mais.appendChild(b);
  };
  acao('key-round', 'Entrar com código…', () => { fecharModal(P); contaAcao(P, 'trocarCodigo', eng); });
  // o cartao acima le a conta DESTE Mac; com o chat na VPS quem responde e o servidor
  if (NA_VPS(P.cwd)) acao('server', 'Ver a conta da VPS…', () => { fecharModal(P); contaAcao(P, 'status', eng); });
  $('#ctTrocar', cx).onclick = () => { fecharModal(P); contaAcao(P, 'trocar', eng); };
  $('#ctSair', cx).onclick = () => { fecharModal(P); contaAcao(P, 'logout', eng); };
  $('#ctOk', cx).onclick = () => fecharModal(P);

  /* as contas GUARDADAS deste motor (as mesmas do menu "Contas guardadas") entram como os
     outros radios: clicar troca na hora, sem navegador — o mesmo trocarParaConta de la. */
  if (eng !== 'claude' && eng !== 'codex') return;
  let guardadas = [];
  try { const r = await window.api.contasListar(eng); guardadas = Array.isArray(r) ? r : []; } catch {}
  if (modal.classList.contains('hidden') || !lista.isConnected) return;
  for (const g of guardadas) {
    if (g.atual) continue;
    const b = document.createElement('button');
    b.className = 'ct-linha';
    b.innerHTML = '<span class="ct-radio"></span><span class="ct-txt"><span class="ct-n"></span><span class="ct-e">Guardada neste Mac</span></span>';
    $('.ct-n', b).textContent = g.apelido;
    b.title = 'Trocar para esta conta';
    b.onclick = () => { fecharModal(P); trocarParaConta(P, eng, g.apelido); };
    lista.appendChild(b);
  }
}

/* ---------- contas guardadas: alternar sem refazer login ----------
   Coisa DIFERENTE do "Trocar de conta" da janela da Conta, que sai e entra pelo CLI abrindo o
   navegador. Aqui e' so' trocar o arquivo da credencial por uma copia ja guardada — dois
   segundos em vez de dois minutos. Por isso o rotulo e' "Contas guardadas". */
async function menuContas(P, motorPedido) {
  const eng = motorPedido || P.engine;
  const nomeEng = eng === 'codex' ? 'Codex' : 'Claude';
  let guardadas = [], podeGuardar = false, porqueNao = '';
  // le antes de abrir: no disco isso e instantaneo, e assim o menu nao pisca vazio
  try { const r = await window.api.contasListar(eng); guardadas = Array.isArray(r) ? r : []; } catch {}
  try { const d = await window.api.contasDisponivel(eng); podeGuardar = !!(d && d.ok); porqueNao = (d && (d.motivo || d.error)) || ''; } catch {}

  const m = novoMenu(P);
  m.appendChild(tituloPopup('Contas guardadas', 'Contas do ' + nomeEng + ' já logadas neste Mac. Clicar troca na hora, sem passar pelo navegador.'));
  // a que está em uso ganha o ✓ à esquerda: "em uso agora"/"trocar para esta" saíram da tela
  for (const g of guardadas) {
    m.appendChild(elItem({
      ic: 'user', nome: g.apelido, on: g.atual,
      dica: g.atual ? 'em uso agora' : 'trocar para esta',
    }, () => { if (!g.atual) trocarParaConta(P, eng, g.apelido); }));
  }
  if (guardadas.length) m.appendChild(elLinha());
  if (podeGuardar) {
    const c = contaCache[eng];
    m.appendChild(elItem({ ic: 'plus', nome: 'Guardar a conta de agora…', desc: (c && c.email) || '' },
      () => guardarContaAtual(P, eng)));
  } else {
    /* O item continua na lista, DESATIVADO, como o Mac faz: sumir sem explicação parece defeito.
       O porquê (ex.: "no Mac a conta do Claude fica no Chaveiro…") vai no balão do mouse. */
    m.appendChild(elItem({ ic: 'lock', nome: 'Guardar a conta de agora…', off: true,
      dica: porqueNao || 'não dá para guardar a conta de agora' }));
  }
  if (guardadas.length) m.appendChild(elItem({ ic: 'eraser', nome: 'Esquecer uma conta guardada…',
    dica: 'apaga só a cópia guardada aqui; o login continua onde está' }, () => menuEsquecerConta(P, eng)));
}

async function guardarContaAtual(P, eng) {
  let c = contaCache[eng];
  if (!c) { try { c = await window.api.contaLer(eng); } catch {} }
  const sugestao = String((c && c.email) || '').split('@')[0] || '';
  const apelido = await perguntarTexto(P, 'Guardar esta conta',
    'Dê um apelido para reconhecer depois. A cópia fica guardada neste Mac.', sugestao);
  if (!apelido || !apelido.trim()) return;
  const nome = apelido.trim();
  const r = await window.api.contasSalvar({ engine: eng, apelido: nome });
  if (!r || r.error) { note(P, 'Não consegui guardar: ' + ((r && r.error) || 'erro'), true); return; }
  // R4: sucesso por note() sem `true` nao apareceria na tela
  avisoTemp(P, 'Conta guardada como “' + nome + '”. Agora dá para alternar em “Contas guardadas”.');
}

async function menuEsquecerConta(P, eng) {
  let lista = [];
  try { const r = await window.api.contasListar(eng); lista = Array.isArray(r) ? r : []; } catch {}
  if (!lista.length) { avisoTemp(P, 'Nenhuma conta guardada.'); return; }
  const m = novoMenu(P);
  m.appendChild(tituloPopup('Esquecer conta guardada', 'Esquecer apaga só a cópia guardada aqui — não desconecta a conta nem faz logout.'));
  for (const g of lista) {
    // "Em uso" é o estado (valor à direita, como no design); "guardada" era óbvio e saiu
    m.appendChild(elItem({ ic: 'eraser', nome: g.apelido, tag: g.atual ? 'Em uso' : '' }, async () => {
      const r = await window.api.contasEsquecer({ engine: eng, apelido: g.apelido });
      if (!r || r.error) { note(P, 'Não consegui esquecer: ' + ((r && r.error) || 'erro'), true); return; }
      avisoTemp(P, 'Conta “' + g.apelido + '” esquecida aqui. O login em si continua onde estava.');
    }));
  }
}

async function trocarParaConta(P, eng, apelido) {
  if (motoresTrocandoConta.has(eng)) return;
  const nomeEng = eng === 'codex' ? 'Codex' : 'Claude';
  // troca de conta derruba TODO painel deste motor, mesmo o de outra aba que o usuario nao
  // esta olhando; se algum estiver ocupado, perguntar antes de cortar (igual fechar aba/trocar motor)
  // painel na VPS fica de fora: a conta de la e' outra, controlada pelo servidor, e nao muda aqui
  const ocupados = [...panes.values()].filter(Q => Q.engine === eng && !NA_VPS(Q.cwd) && (Q.busy || agTrabalhando(Q)));
  if (ocupados.length) {
    const msg = ocupados.length === 1
      ? 'O ' + nomeEng + ' está trabalhando em “' + ((ocupados[0].titulo || '').trim().slice(0, 40) || 'um chat') + '”.\n\nTrocar de conta agora joga fora o que ele está fazendo. Continuar mesmo assim?'
      : 'O ' + nomeEng + ' está trabalhando em ' + ocupados.length + ' chats (em outras abas).\n\nTrocar de conta agora joga fora o que eles estão fazendo. Continuar mesmo assim?';
    if (!confirm(msg)) return;
  }
  motoresTrocandoConta.add(eng);
  try {
  /* PRIMEIRO parar os motores. Um CLI vivo renova o token e reescreve o arquivo da credencial:
     trocar com ele rodando podia ser desfeito calado, minutos depois. */
  let religados = 0;
  for (const Q of [...panes.values()]) {
    if (Q.engine !== eng || NA_VPS(Q.cwd)) continue; // VPS nao muda de conta aqui, nao interromper
    await desligarMotor(Q);
    // religa na MESMA conversa: a sessao e' arquivo local, nao pertence a conta
    Q.resumeId = Q.sessaoId || Q.resumeId; Q.sessaoId = null;
    if (Q.resumeId) religados++;      // chat que nunca rodou nao "religa"
    Q.started = false;
  }
  /* o Codex compartilha UM app-server entre todos os paineis, e ele leu a conta quando subiu:
     parar painel nao basta, tem de derrubar o motor pra ele reler a credencial. Sem isto a
     tela dizia "Conta trocada" e o Codex seguia respondendo pela conta antiga. */
  if (eng === 'codex') { try { await window.api.codexReiniciar(); } catch {} }
  savePanes();
  const r = await window.api.contasTrocar({ engine: eng, apelido });
  if (!r || r.error) {
    // os chats ja foram desligados aqui em cima: nao deixa ele achar que nao aconteceu nada
    note(P, ((r && r.error) || 'não consegui trocar a conta')
      + (religados ? ' — a conta NÃO mudou; os chats religam na conta de antes na próxima mensagem.' : ''), true);
    return;
  }
  contaCache[eng] = null; pintarContaLateral(eng, true);
  USO_FECHADO[eng] = null; lerUso(eng, true);
  avisoTemp(P, 'Conta do ' + nomeEng + ' trocada para “' + apelido + '”'
    + (religados ? ' · ' + religados + ' chat(s) religam na conta nova na próxima mensagem' : '') + '.');
  } catch (e) {
    note(P, 'Não consegui trocar a conta: ' + (e.message || e), true);
  } finally { motoresTrocandoConta.delete(eng); }
}

/* ---------- aviso de limite do plano, em cima da caixa de texto ----------
   Fica escondido. So aparece sozinho quando passa de um dos dois pontos abaixo,
   e o x fecha. Fechado, so volta se subir mais USO_DENOVO pontos ou se o ciclo zerar. */
const USO_AVISO_SESSAO = 90;
const USO_AVISO_SEMANA = 50;
const USO_DENOVO = 5;
const USO_INTERVALO = 300000;      // relê no maximo de 5 em 5 minutos
const USO = { claude: null, codex: null, acp: null, gemini: null, grok: null };
/* O "ja fechei este aviso" mora aqui, por MOTOR — antes ficava em cada chat, entao com 3 chats
   abertos apareciam 3 tarjas iguais e ele tinha de fechar uma por uma. E quando a leitura do
   limite falhava (rede, 429, token), o codigo antigo APAGAVA o "fechado" e a tarja renascia
   sozinha na leitura seguinte. Agora falha de leitura so esconde; nao esquece. */
const USO_FECHADO = { claude: null, codex: null, acp: null, gemini: null, grok: null };
const USO_QUANDO = { claude: 0, codex: 0, acp: 0, gemini: 0, grok: 0 };
const USO_LENDO = { claude: false, codex: false, acp: false, gemini: false, grok: false };

const codexGlobais = { contaTimer: null, conectoresTimer: null, lendoConta: false, lendoConectores: false, vistos: new Map() };
function receberEventoGlobalCodex(ev) {
  if (!ev) return;
  const destino = ev.destino || 'local';
  const chave = JSON.stringify([destino, ev.kind, ev.method, ev.text, ev.rateLimits, ev.status, ev.serverName, ev.success]);
  const agora = Date.now();
  if (agora - (codexGlobais.vistos.get(chave) || 0) < 1000) return;
  codexGlobais.vistos.set(chave, agora);
  if (codexGlobais.vistos.size > 80) codexGlobais.vistos.delete(codexGlobais.vistos.keys().next().value);
  if (ev.kind === 'note') {
    const alvo = [focusPane, ...panes.values()].find(P => P && P.engine === 'codex' && (NA_VPS(P.cwd) ? 'vps' : 'local') === destino);
    if (alvo) note(alvo, ev.text || 'Aviso do Codex', ev.error);
    return;
  }
  // O cartão da barra lateral representa a conta do Mac. A VPS tem sua própria conta.
  if (destino !== 'local') return;
  if (ev.kind === 'account' && ev.rateLimits) {
    const jan = x => x ? { pct: Math.round(x.usedPercent || 0), reseta: (x.resetsAt || 0) * 1000, mins: x.windowDurationMins || 0 } : null;
    const r = ev.rateLimits;
    USO.codex = { ...(USO.codex || {}), sessao: jan(r.primary), semana: jan(r.secondary),
      limitado: (r.primary && r.primary.usedPercent >= 100) || (r.secondary && r.secondary.usedPercent >= 100) || false };
    USO_QUANDO.codex = agora;
    if (contaCache.codex) Object.assign(contaCache.codex, USO.codex);
    for (const P of panes.values()) if (P.engine === 'codex' && !NA_VPS(P.cwd)) pintarUso(P);
    if (contaCache.codex) pintarContaLateral('codex');
    return;
  }
  if (ev.kind === 'account' && !codexGlobais.lendoConta && !codexGlobais.contaTimer) {
    codexGlobais.contaTimer = setTimeout(async () => {
      codexGlobais.contaTimer = null; codexGlobais.lendoConta = true;
      try {
        await pintarContaLateral('codex', true);
        const c = contaCache.codex;
        if (c) { USO.codex = { ...(USO.codex || {}), sessao: c.sessao || null, semana: c.semana || null, limitado: !!c.limitado };
          USO_QUANDO.codex = Date.now(); for (const P of panes.values()) if (P.engine === 'codex') pintarUso(P); }
        for (const P of panes.values()) {
          const modal = $('.p-modal', P.el);
          if (modal && !modal.classList.contains('hidden') && modal.dataset.codexSurface === 'account') await janelaConta(P, 'codex');
        }
      } catch (e) { console.warn('Não foi possível atualizar a conta do Codex:', e.message); }
      finally { codexGlobais.lendoConta = false; }
    }, 180);
  }
  if (ev.kind === 'connectors' && !codexGlobais.lendoConectores && !codexGlobais.conectoresTimer) {
    codexGlobais.conectoresTimer = setTimeout(async () => {
      codexGlobais.conectoresTimer = null; codexGlobais.lendoConectores = true;
      try {
        // Lista fechada não precisa buscar nada: sua abertura já consulta o estado atual.
        const P = [...panes.values()].find(p => { const m = $('.p-modal', p.el);
          return p.engine === 'codex' && m && !m.classList.contains('hidden') && m.dataset.codexSurface === 'connectors'; });
        if (P) await janelaConectores(P);
      } catch (e) { console.warn('Não foi possível atualizar os conectores:', e.message); }
      finally { codexGlobais.lendoConectores = false; }
    }, 180);
  }
}
if (window.api.onCodexEvent) window.api.onCodexEvent(receberEventoGlobalCodex);

async function lerUso(engine, forcar) {
  // ACP não tem cota que dê para ler daqui. Gemini e Grok leem da conta logada.
  if (engine === 'acp') return;
  if (!window.api || !window.api.usoLer) return;
  if (USO_LENDO[engine]) return;
  if (!forcar && Date.now() - (USO_QUANDO[engine] || 0) < USO_INTERVALO) return;
  USO_LENDO[engine] = true;
  try {
    const u = await window.api.usoLer(engine);
    USO[engine] = u || null;
  } catch {}
  USO_QUANDO[engine] = Date.now();
  USO_LENDO[engine] = false;
  for (const P of panes.values()) if (P.engine === engine) pintarUso(P);
  // Zerar o cache aqui obrigava o cartao da conta a chamar de novo a parte PESADA
  // ("claude auth status", 25s de teto, mais outra consulta ao limite) a cada fim de resposta,
  // a cada chat novo e a cada 5 minutos. Isso fazia o painel piscar e, pior, batia tanto na
  // consulta de limite que a Anthropic passava a responder 429. Os numeros novos ja estao em
  // USO[engine]: da pra atualizar o cartao sem chamar nada.
  // o main ja devolve o ultimo numero bom quando a consulta falha (com a hora dele em "velho"):
  // copiar tudo como veio, sem misturar com o cartao antigo
  const cc = contaCache[engine], uu = USO[engine];
  if (cc && uu) Object.assign(cc, { sessao: uu.sessao, semana: uu.semana, limitado: !!uu.limitado,
    velho: uu.velho || 0, semSessao: !!uu.semSessao, voltaEm: uu.voltaEm || 0 });
  pintarContaLateral(engine);
}

const usoPct = (j) => j ? Math.min(100, Math.max(0, Math.round(j.pct || 0))) : null;

function esconderUso(P) {
  const faixa = $('.p-uso', P.el);
  if (faixa) { faixa.className = 'p-uso hidden'; faixa.innerHTML = ''; }
}

/* O numero pequeno do rodape, ao lado do modelo. Vive FORA da tarja de alarme de proposito:
   a tarja so nasce em 90% de sessao ou 50% de semana, e abaixo disso a tela nao dizia nada —
   ele planejava o dia no escuro com o numero ja pronto na memoria. Sem cor: quem grita e a
   tarja. Some sozinho no motor que nao tem cota de ler daqui (ACP). */
function pintarLimiteMini(P) {
  const el = $('.p-limite', P.el);
  if (!el) return;
  const u = USO[P.engine];
  const ps = u ? usoPct(u.sessao) : null, pw = u ? usoPct(u.semana) : null;
  const partes = [];
  if (ps !== null) partes.push('sessão ' + ps + '%');
  if (pw !== null) partes.push('semana ' + pw + '%');
  el.textContent = partes.join(' · ');
  el.title = partes.length ? 'Quanto do plano do ' + nomeDoMotor(P.engine) + ' já foi usado' : '';
}

function pintarUso(P) {
  pintarLimiteMini(P);          // o numero do rodape nao depende da tarja de alarme
  const faixa = $('.p-uso', P.el);
  if (!faixa) return;
  const u = USO[P.engine];
  if (!u) return esconderUso(P);       // leitura falhou: escondo, mas NAO esqueco o que ele fechou
  const ps = usoPct(u.sessao), pw = usoPct(u.semana);

  const passou = (ps !== null && ps >= USO_AVISO_SESSAO) || (pw !== null && pw >= USO_AVISO_SEMANA);
  if (!passou) { USO_FECHADO[P.engine] = null; esconderUso(P); return; }   // voltou ao normal

  // ja foi fechado neste patamar: so reaparece se piorar de verdade.
  // baseline null = a metrica nao tinha dado nenhum quando fechou (nao dava pra comparar
  // crescimento); nesse caso qualquer valor real que chegar depois ja conta como piora, senao
  // a tarja ficava travada em 999% pra sempre e nunca mais avisava daquela metrica
  const f = USO_FECHADO[P.engine];
  if (f
    && (f.sessao === null ? ps === null : (ps === null || ps < f.sessao + USO_DENOVO))
    && (f.semana === null ? pw === null : (pw === null || pw < f.semana + USO_DENOVO))
  ) { esconderUso(P); return; }

  const naSessao = ps !== null && ps >= USO_AVISO_SESSAO;
  const zera = naSessao ? u.sessao : u.semana;
  /* Redesenho (README, "Aviso de limite"): anel de 12 cheio no % + "Semana 95%" + "zera em 23h"
     + ×. Sem a frase ("Metade do limite da semana"), sem ▲ e sem âmbar: o número diz tudo. Mostra
     a janela que passou do ponto; os dois números seguem no title e no rodapé da caixa. */
  const pct = naSessao ? ps : pw;
  const cheio = (Math.max(0, Math.min(100, pct || 0)) / 100 * 37.7).toFixed(1);
  faixa.className = 'p-uso aviso';
  faixa.innerHTML = '<svg class="uso-anel" viewBox="0 0 16 16" aria-hidden="true">'
    + '<circle class="ua-fundo" cx="8" cy="8" r="6"></circle>'
    + '<circle class="ua-fio" cx="8" cy="8" r="6" stroke-dasharray="' + cheio + ' 37.7" transform="rotate(-90 8 8)"></circle></svg>'
    + '<span class="uso-alerta">' + (naSessao ? 'Sessão ' : 'Semana ') + (pct === null ? '—' : pct + '%') + '</span>'
    + (zera && zera.reseta ? '<span class="uso-zera">zera ' + quandoFuturo(zera.reseta) + '</span>' : '')
    // leitura atual falhou e este numero e' reaproveitado de antes: avisar que esta desatualizado,
    // senao a tarja mais importante da tela passa um numero velho como se fosse o de agora
    + (u.velho ? '<span class="uso-velho">dado de ' + haQuanto(u.velho) + ' atrás</span>' : '')
    + '<span class="uso-gap"></span>'
    + '<button class="uso-x" title="Fechar este aviso" aria-label="Fechar este aviso">'
    + '<svg viewBox="0 0 16 16" class="ic" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"></path></svg></button>';
  faixa.title = 'Plano do ' + nomeDoMotor(P.engine) + ': '
    + 'sessão ' + (ps === null ? 'sem dado' : ps + '%') + ', semana ' + (pw === null ? 'sem dado' : pw + '%') + '.';
  $('.uso-x', faixa).onclick = (e) => { e.stopPropagation(); fecharUso(P); };
}

function fecharUso(P) {
  const u = USO[P.engine];
  if (!u) return esconderUso(P);
  const ps = usoPct(u.sessao), pw = usoPct(u.semana);
  // guardar null quando a metrica nao tinha dado (nao forcar 999): 999 travava a baseline
  // pra sempre e a tarja nunca mais voltava a avisar daquela metrica quando ela chegasse
  USO_FECHADO[P.engine] = { sessao: ps, semana: pw };
  // um X so: fechar num chat cala o aviso em TODOS os chats do mesmo motor
  for (const q of panes.values()) if (q.engine === P.engine) esconderUso(q);
}

// acabou de responder: o gasto mudou, mas sem repetir a leitura a toda hora
function lerUsoAposResposta(engine) {
  if (Date.now() - (USO_QUANDO[engine] || 0) < 45000) return;
  lerUso(engine, true);
}

function usoDeTodos(forcar) {
  for (const e of new Set([...panes.values()].map(p => p.engine))) lerUso(e, forcar);
}
setInterval(() => usoDeTodos(false), USO_INTERVALO);

/* A hora em que o limite zera, como no desenho: "zera 14:20" quando é hoje e "zera seg 09:00"
   em outro dia (o limite semanal zera em até 7 dias; passando disso vai a data, "zera 03/10
   09:00", para o dia da semana não enganar). Hora local do Mac, 24 h. */
function textoDoZera(ms) {
  const agora = Date.now();
  if (!(ms > agora)) return 'já zerou';
  const d = new Date(ms), h = new Date(agora), dd = (n) => String(n).padStart(2, '0');
  const hm = dd(d.getHours()) + ':' + dd(d.getMinutes());
  const dias = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate())
    - new Date(h.getFullYear(), h.getMonth(), h.getDate())) / 864e5);
  if (dias === 0) return 'zera ' + hm;
  if (dias < 7) return 'zera ' + ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()] + ' ' + hm;
  return 'zera ' + dd(d.getDate()) + '/' + dd(d.getMonth() + 1) + ' ' + hm;
}

function quandoFuturo(ms) {
  const d = ms - Date.now();
  if (d <= 0) return 'já zerou';
  const min = Math.round(d / 60000);
  if (min < 60) return 'em ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'em ' + h + 'h';
  const dias = Math.round(h / 24);
  return 'em ' + dias + (dias === 1 ? ' dia' : ' dias');
}

// o Claude devolve JSON, o Codex devolve uma frase: os dois viram { dentro, quem }
function lerStatusConta(txt) {
  const t = String(txt || '').trim();
  if (!t) return { dentro: false, quem: '' };
  try {
    const j = JSON.parse(t);
    const quem = j.email || j.account || j.organization || j.authMethod || '';
    return { dentro: j.loggedIn === true, quem: String(quem) };
  } catch {}
  if (/not logged in|não logado|no credentials|logged out|not authenticated/i.test(t)) return { dentro: false, quem: '' };
  const email = (t.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || '';
  return { dentro: true, quem: email || t.split('\n')[0].slice(0, 80) };
}

/* O 3o argumento diz de QUAL motor e a conta. Sem ele, com um chat do Codex em foco o
   botao "Entrar" (ou "Sair") do cartao do Claude mexia na conta do CODEX. Quem nao passa
   nada continua caindo no motor do proprio chat, como antes. */
async function contaAcao(P, acao, motorPedido) {
  const eng = motorPedido || P.engine;
  const r = await window.api.auth({ engine: eng, acao, cwd: P.cwd });
  if (!r) return;
  if (r.error) return note(P, 'Não consegui: ' + r.error, true);
  if (acao === 'status') { avisoTemp(P, (r.texto || 'sem resposta').split('\n').slice(0, 4).join(' · ')); return; }
  if (!r.terminal) return;
  document.body.classList.remove('gaveta');

  janelaTerminal(P, r.terminal, r.titulo || 'Conta', async () => {
    if (['gemini', 'grok'].includes(eng)) {
      contaCache[eng] = null;
      await pintarContaLateral(eng, true);
      const c = contaCache[eng];
      if (c?.entrou === true) {
        // Fechar a entrada não pode interromper um trabalho que já está em andamento.
        for (const q of panes.values()) {
          if (q.engine !== eng || q.busy) continue;
          await desligarMotor(q);
        }
        avisoTemp(P, 'Entrada salva no ' + nomeDoMotor(eng) + (c.email ? ': ' + c.email : '.'));
      } else {
        avisoTemp(P, c?.motivo || 'A entrada ainda não foi confirmada. Termine no navegador e clique em Conferir.');
      }
      return;
    }
    // todo chat do mesmo motor recomeca, senao continua falando pela conta velha — mas se algum
    // estiver ocupado, perguntar antes de cortar (mesmo padrao de trocarParaConta)
    // a conta da VPS e' outra, controlada pelo servidor de la: trocar de conta local nao
    // pode perguntar nem cortar chat que esta rodando na VPS (mesma regra do trocarParaConta)
    const ocupados = [...panes.values()].filter(q => q.engine === eng && !NA_VPS(q.cwd) && (q.busy || agTrabalhando(q)));
    if (ocupados.length) {
      const msg = ocupados.length === 1
        ? 'O ' + nomeDoMotor(eng) + ' está trabalhando em “' + ((ocupados[0].titulo || '').trim().slice(0, 40) || 'um chat') + '”.\n\nTrocar de conta agora joga fora o que ele está fazendo. Continuar mesmo assim?'
        : 'O ' + nomeDoMotor(eng) + ' está trabalhando em ' + ocupados.length + ' chats.\n\nTrocar de conta agora joga fora o que eles estão fazendo. Continuar mesmo assim?';
      if (!confirm(msg)) { avisoTemp(P, 'Nada foi cortado. Mande uma mensagem quando puder trocar.'); return; }
    }
    for (const q of panes.values()) {
      if (q.engine !== eng || NA_VPS(q.cwd)) continue; // VPS nao muda de conta aqui, nao interromper
      await desligarMotor(q);
      // religa na MESMA conversa: a sessao e' arquivo local, nao pertence a conta
      q.resumeId = q.sessaoId || q.resumeId; q.sessaoId = null;
    }
    if (!r.confereDepois) { avisoTemp(P, 'Pronto. Mande uma mensagem para começar de novo.'); return; }
    avisoTemp(P, 'Conferindo qual conta ficou…');
    const st = await window.api.auth({ engine: eng, acao: 'status', cwd: P.cwd });
    const txt = ((st && st.texto) || '').trim();
    const r2 = lerStatusConta(txt);
    if (r2.dentro) {
      // Codex compartilha UM app-server que so le a conta ao subir: sem reiniciar, a tela diz
      // "conta trocada" mas ele segue respondendo pela conta antiga (mesmo motivo de trocarParaConta)
      if (eng === 'codex') { try { await window.api.codexReiniciar(); } catch {} }
      avisoTemp(P, 'Conta trocada' + (r2.quem ? ': ' + r2.quem : '.'));
      USO_FECHADO[eng] = null; lerUso(eng, true);
      // trocou de conta: aqui SIM vale reler o cartao inteiro, pro e-mail e o plano mudarem
      contaCache[eng] = null; pintarContaLateral(eng, true);
    } else {
      avisoTemp(P, 'A entrada não terminou. Tente de novo e não feche a janela até o navegador confirmar. Se o navegador não abrir, use "entrar com código".', true);
    }
  }, { abrirSozinho: !!r.esperaLink && !r.naVps, orientacao: r.orientacao });
}

/* ehErro: quatro chamadas ja mandavam o terceiro valor ("isto e erro") e ele era jogado fora —
   "o Gemini nao esta instalado aqui" saia no mesmo cinza de "Foto anexada". A regra .note.err
   (vermelho, e vermelho de variavel: vale nos 3 temas) ja existia no style.css.
   O `vazio`: num chat que ainda nao tem conversa, o clearEmpty tira a tela de "Escreva embaixo
   pra comecar" — e 12 segundos depois o recado sumia e sobrava um retangulo em branco. Agora a
   tela de chat vazio volta junto, mas so se nada tiver comecado nesse meio-tempo. */
function avisoTemp(P, texto, ehErro) {
  const vazio = !!$('.pane-empty', P.el);
  clearEmpty(P);
  const d = document.createElement('div');
  d.className = 'note' + (ehErro ? ' err' : ''); d.textContent = texto;
  P.chat.appendChild(d); scroll(P, true);
  setTimeout(() => { d.remove(); if (vazio && !P.chat.children.length) voltarVazio(P); }, 12000);
}

/* ===================== leva 6: faixa de avisos da JANELA =====================
   O avisoTemp acima e o note() moram DENTRO de um chat: a mensagem sobe junto com a conversa
   e some. Um recado que vale para a janela inteira — "chegou uma foto do celular" — precisa
   de um lugar próprio, que fique parado até ele resolver.

   Nomes com prefixo `fx` de propósito: a classe `.aviso` já é usada aqui pela tarja de limite
   do plano (`faixa.className = 'p-uso aviso'`), e as regras `.aviso` do fork de origem a
   repintariam inteira. */
/* guarda COMO ele dispensou: { nivel, reseta }.
   - nivel: se a coisa piorar, volta a avisar.
   - reseta: quando a semana (ou a sessão) vira, a dispensa antiga morre junto. */
const avisosFechados = new Map();
/* Ícone da tarja (README, "Faixa de aviso" e "Estados"): a bandeja da caixa de entrada para o
   aviso comum; alerta e erro usam o triângulo, e quem diz qual é qual é a cor (janela.css) mais o
   texto. Antes era um círculo com "?" e um X, que parecia botão de fechar. Chat esperando você
   não tem ícone de traço: o círculo com "!" é desenhado pelo janela.css (.fx-espera). */
function icoDoAviso(tipo) { return tipo === 'espera' ? '' : (tipo === 'alerta' || tipo === 'erro' ? 'warn' : 'tray'); }
/* O texto da tarja pode vir em pedaços: ['Chegou ', { mono: 'contrato.pdf' }, ' na caixa de
   entrada']. { mono } sai em SF Mono (nome de arquivo, tela 21); { espera } na cor de "esperando
   você". Tudo por textContent, nunca innerHTML: o nome do arquivo vem de outra máquina. */
function escreverAviso(el, texto) {
  el.textContent = '';
  for (const p of [].concat(texto)) {
    if (p && typeof p === 'object') {
      const s = document.createElement('span');
      s.className = 'mono' in p ? 'fx-mono' : 'fx-destaque';
      s.textContent = String('mono' in p ? p.mono : p.espera);
      el.appendChild(s);
    } else el.appendChild(document.createTextNode(p == null ? '' : String(p)));
  }
}
function mostrarAviso({ id, texto, tipo, acao, aoClicar, fixo, nivel, reseta, aoFechar }) {
  const caixa = $('#faixaAvisos');
  if (!caixa) return;
  // dispensado antes: fica calado até a situação piorar ou a janela virar
  if (id && avisosFechados.has(id)) {
    const antes = avisosFechados.get(id) || {};
    const virou = reseta && antes.reseta && reseta !== antes.reseta;
    const piorou = typeof nivel === 'number' && typeof antes.nivel === 'number' && nivel > antes.nivel;
    if (!virou && !piorou) return;
    avisosFechados.delete(id);
  }
  /* CSS.escape: o id vem de dado real (nome de arquivo da caixa de entrada). Sem ele, um nome
     com "\" ou "." dentro faria o seletor não casar com nada e cada chegada empilharia uma
     tarja nova em vez de atualizar a que já está na tela. */
  const existente = id && $('[data-aviso="' + CSS.escape(id) + '"]', caixa);
  const marcar = (el) => avisosFechados.set(id, {
    nivel: el.dataset.nivel !== undefined ? Number(el.dataset.nivel) : 0,
    reseta: el.dataset.reseta !== undefined ? Number(el.dataset.reseta) : 0,
  });
  if (existente) {
    const t = $('.fx-txt', existente);
    if (t) escreverAviso(t, texto);
    existente.className = 'fx fx-' + (tipo || 'info');
    if (typeof nivel === 'number') existente.dataset.nivel = String(nivel);
    if (reseta) existente.dataset.reseta = String(reseta);
    const ic = $('.fx-ic', existente);
    if (ic) ic.innerHTML = ico(icoDoAviso(tipo));
    // o texto novo vem com ação nova: o botão e o X têm de apontar para ESTA chamada
    const btAntigo = $('.fx-acao', existente);
    if (acao) {
      const bt = btAntigo || document.createElement('button');
      bt.className = 'fx-acao';
      bt.textContent = acao;
      bt.onclick = () => { try { aoClicar && aoClicar(); } catch {} existente.remove(); };
      if (!btAntigo) existente.insertBefore(bt, $('.fx-x', existente));
    } else if (btAntigo) btAntigo.remove();
    const xAntigo = $('.fx-x', existente);
    if (xAntigo) xAntigo.onclick = () => { if (id) marcar(existente); existente.remove(); if (aoFechar) { try { aoFechar(); } catch {} } };
    // aviso repetido: o prazo recomeça, senão o relógio do primeiro apagava o segundo poucos
    // segundos depois de ele aparecer
    if (!fixo) {
      clearTimeout(existente._t);
      existente._t = setTimeout(() => { if (id) marcar(existente); existente.remove(); }, 20000);
    }
    return;
  }
  const d = document.createElement('div');
  d.className = 'fx fx-' + (tipo || 'info');
  if (id) d.dataset.aviso = id;
  d.innerHTML = '<span class="fx-ic"></span><span class="fx-txt"></span>'
    + (acao ? '<button class="fx-acao"></button>' : '')
    + '<button class="fx-x"></button>';
  $('.fx-ic', d).innerHTML = ico(icoDoAviso(tipo));
  // textContent, nunca innerHTML: o texto carrega nome de arquivo escrito por outra máquina
  escreverAviso($('.fx-txt', d), texto);
  if (acao) {
    $('.fx-acao', d).textContent = acao;
    $('.fx-acao', d).onclick = () => { try { aoClicar && aoClicar(); } catch {} d.remove(); };
  }
  $('.fx-x', d).innerHTML = ico('x');
  $('.fx-x', d).title = 'Fechar';
  if (typeof nivel === 'number') d.dataset.nivel = String(nivel);
  if (reseta) d.dataset.reseta = String(reseta);
  // lê do elemento, não da chamada que o criou: a tarja se atualiza sozinha e o X tem de
  // gravar o que está na tela AGORA
  $('.fx-x', d).onclick = () => { if (id) marcar(d); d.remove(); if (aoFechar) { try { aoFechar(); } catch {} } };
  caixa.appendChild(d);
  // some sozinho, mas NÃO cala para sempre: se piorar, avisa de novo
  if (!fixo) d._t = setTimeout(() => { if (id) marcar(d); d.remove(); }, 20000);
}

/* caixa de entrada: áudio transcrito / foto que chegou do celular (ou de um script) vira
   tarja com "usar" — o texto vai para o campo do chat em foco, a imagem vira anexo */
function chegouNaInbox(m) {
  if (!m || !m.arquivo) return;
  const corta = (s) => '“' + String(s || '').replace(/\s+/g, ' ').slice(0, 80) + (String(s || '').length > 80 ? '…' : '') + '”';
  // o mesmo nome regravado: a tarja antiga apontava para o MESMO caminho, e o X dela apagaria
  // a mensagem NOVA
  try { $$('#faixaAvisos [data-aviso^="inbox-' + CSS.escape(m.nome) + '-"]').forEach((t) => t.remove()); } catch {}
  // R3-025: a legenda chegou antes da foto e ja virou tarja de texto sozinha — some com ela
  // agora que a foto trouxe a MESMA legenda, senao a mesma frase fica duas vezes na tela
  if (m.substituiuNome) { try { $$('#faixaAvisos [data-aviso^="inbox-' + CSS.escape(m.substituiuNome) + '-"]').forEach((t) => t.remove()); } catch {} }
  const idAviso = 'inbox-' + m.nome + '-' + Math.round((m.quando || Date.now()) / 1000);
  mostrarAviso({
    // id por arquivo E hora: o mesmo nome noutro dia não herda o "fechado" do anterior
    id: idAviso, tipo: 'info', fixo: true,
    // sem emoji: o ícone da bandeja na frente da tarja já diz de onde veio. Arquivo: o nome em
    // SF Mono, como na tela 21 ("Chegou contrato.pdf na caixa de entrada"); recado de texto
    // continua com o trecho entre aspas
    texto: m.tipo === 'texto' ? 'Chegou do celular: ' + corta(m.texto)
      : ['Chegou ', { mono: m.nome || 'imagem' }, ' na caixa de entrada' + (m.legenda ? ' · ' + corta(m.legenda) : '')],
    acao: 'Usar no chat',
    aoClicar: () => usarDaInbox(m),
    // o X descarta de verdade (apaga da caixa); só esconder faria o arquivo voltar a cada
    // abertura do app, para sempre
    aoFechar: () => { try { window.api.inboxConsumir({ arquivo: m.arquivo, apagar: true }); } catch {} },
  });
  // o X aqui não só esconde: apaga da caixa. Dizer isso.
  try { const x = $('#faixaAvisos [data-aviso="' + CSS.escape(idAviso) + '"] .fx-x'); if (x) x.title = 'Descartar: apaga da caixa de entrada'; } catch {}
}
async function usarDaInbox(m) {
  const P = focusPane || [...panes.values()][0];
  // R4: note() sem `true` não aparece na tela, e aqui não há chat garantido — a faixa é o
  // único lugar que aparece de qualquer jeito
  if (!P) { mostrarAviso({ tipo: 'alerta', texto: 'Abra um chat primeiro; a mensagem continua na caixa de entrada.' }); return; }
  let r = null;
  try { r = await window.api.inboxConsumir({ arquivo: m.arquivo }); } catch {}
  if (m.tipo === 'texto') {
    if (r && r.error) { mostrarAviso({ tipo: 'erro', texto: 'Não consegui tirar o recado da caixa de entrada: ' + r.error }); return; }
    inserirNoInput(P, m.texto || '');
    const c = $('.p-input', P.el); if (c) c.focus();
    mostrarAviso({ tipo: 'info', texto: 'Recado do celular colocado no campo. Confira antes de mandar.' });
  } else if (r && r.arquivo) {
    await anexar(P, [r.arquivo]);
    if (m.legenda) inserirNoInput(P, m.legenda);   // a legenda da foto vai junto, no campo
    // R4: sucesso por avisoTemp/mostrarAviso — note() sem `true` não apareceria
    mostrarAviso({ tipo: 'info', texto: 'Imagem do celular anexada. Escreva o que quer que ele faça.' });
  } else {
    mostrarAviso({ tipo: 'erro', texto: 'Não consegui pegar a imagem da caixa de entrada' + (r && r.error ? ': ' + r.error : '.') });
  }
}

const IMG_EXT = ['png','jpg','jpeg','gif','webp','bmp','heic','svg'];
const TIPO_ICO = (ext) => {
  if (IMG_EXT.includes(ext)) return 'image';
  if (['pdf','doc','docx','txt','md','rtf','pages'].includes(ext)) return 'file-text';
  if (['mp3','wav','m4a','ogg','aac','flac'].includes(ext)) return 'file';
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'file';
  if (['js','ts','py','html','css','json','sh','yml','yaml'].includes(ext)) return 'file-code';
  return 'file';
};
const tamanhoBonito = (b) => {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return Math.round(b / 1024) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
};

async function anexar(P, caminhos) {
  const revisao = P.revisaoConversa || 0;
  for (const c of caminhos) {
    const caminho = typeof c === 'string' ? c : c && c.path;
    if (!caminho || P.anexos.some(a => a.path === caminho)) continue;
    let a;
    try { a = await window.api.anexoLer(caminho); }
    catch (e) { a = { erro: e.message || 'Falha ao ler o anexo.' }; }
    if (!painelAindaAtual(P, revisao)) return;
    if (a && !a.erro && !a.error) {
      // Duas leituras do mesmo arquivo podem terminar juntas.
      if (!P.anexos.some(x => x.path === a.path)) P.anexos.push(a);
    } else avisoTemp(P, 'Não consegui anexar: ' + caminho.split('/').pop() + '. ' + (a && (a.erro || a.error) || ''), true);
  }
  pintarAnexos(P);
}

function fichaAnexo(a, comX, aoTirar, P, Pvisor) {
  /* Dois jeitos de passar o painel, e a diferenca importa:
     - 4o parametro (P): dono da ficha. Liga o visor E fica sendo o gancho de tudo que
       for pendurado aqui no futuro (o botao de OCR do Hugo entra por ele).
     - 5o parametro (Pvisor): liga SOMENTE o clique que abre o arquivo no visor.
     A barra de escrever passa null no 4o e o painel no 5o, entao `P` continua null la
     dentro: extra novo guardado por `if (P ...)` nao nasce sozinho na barra. */
  const Pv = P || Pvisor;   // quem abre o visor; so as 2 linhas abaixo usam
  const d = document.createElement('div');
  d.className = 'anx' + (Pv && a.path ? ' clicavel' : '');
  if (Pv && a.path) d.onclick = (e) => { if (!e.target.closest('.anx-x')) verArquivo(Pv, a.path); };
  d.title = a.path || a.nome || a.name || 'Imagem anexada';
  d.innerHTML = '<div class="anx-mini"></div><div class="anx-txt">'
    + '<span class="anx-n"></span><span class="anx-s"></span></div>'
    + (comX ? '<button class="anx-x">' + ico('x') + '</button>' : '');
  const mini = $('.anx-mini', d);
  if (a.mini) { const img = document.createElement('img'); img.src = a.mini; mini.appendChild(img); }
  else mini.innerHTML = ico(TIPO_ICO(a.ext || ''));
  $('.anx-n', d).textContent = a.nome || a.name || String(a.path || '').split('/').pop() || 'Imagem anexada';
  $('.anx-s', d).textContent = [(a.ext || '').toUpperCase(), tamanhoBonito(a.bytes)].filter(Boolean).join(' · ');
  if (comX) $('.anx-x', d).onclick = () => aoTirar(a);
  /* Imagem anexada ganha o botao "texto": tira o que esta ESCRITO nela (OCR aqui no Mac, ~1 s)
     e poe no campo, para ele editar antes de mandar. Chega pelo 5o parametro — e' por ali que
     a barra de escrever passa o painel — entao o gancho e' o `Pv`, que sabe de que painel a
     ficha e' nos DOIS caminhos (barra de escrever e mensagem ja mandada), igual ao fork de
     origem. SVG e' desenho em texto, nao tem o que ler; arquivo da VPS nao mora neste Mac. */
  const extAnx = String(a.ext || '').toLowerCase();
  if (Pv && a.path && !NA_VPS(a.path) && extAnx !== 'svg' && IMG_EXT.includes(extAnx)) {
    const bt = document.createElement('button');
    bt.className = 'anx-ocr';
    bt.textContent = a._ocr ? 'lendo…' : 'texto';
    bt.disabled = !!a._ocr;
    bt.title = 'Tirar o texto que está dentro desta imagem e pôr no campo';
    bt.onclick = (e) => { e.stopPropagation(); extrairTexto(Pv, a, bt); };
    d.appendChild(bt);
  }
  return d;
}

function pintarAnexos(P) {
  const barra = $('.p-anexos', P.el);
  barra.innerHTML = '';
  barra.classList.toggle('hidden', !P.anexos.length);
  for (const a of P.anexos) {
    barra.appendChild(fichaAnexo(a, true, (x) => {
      P.anexos = P.anexos.filter(y => y.path !== x.path);
      // removeu o ultimo anexo: se era o do quadro, o metadado nao pode ficar preso
      // (senao send() acha que ainda ha algo pra mandar e sai uma mensagem vazia)
      if (!P.anexos.length) P.quadroColado = null;
      pintarAnexos(P);
    }, null, P));   // 5o parametro: clique na fichinha abre o arquivo no visor, e so isso
  }
  queueMicrotask(() => window.dispatchEvent(new Event('cockpit:salvar-rascunhos')));
}

/* ================= completar caminho de arquivo com "@" =================
   Digitou "@" em qualquer ponto da linha e o menu mostra os arquivos da pasta DESTE painel —
   inclusive quando a pasta mora na VPS. Escolheu, o caminho inteiro entra na mensagem. */
/* Timer e geracao SAO DO PAINEL (P._buscaArqTimer / P._buscaArqGen), nao globais: eram
   variaveis unicas do modulo, entao mandar mensagem ou fechar QUALQUER outro painel cancelava
   a busca de arquivo em andamento de um painel diferente — send()/closePane de um painel B
   derrubava o timer do painel A sem os dois terem nada a ver. */
/* Geracao da busca. Na VPS a resposta demora e pode chegar DEPOIS da tecla seguinte: sem
   isto a lista velha pintava por cima da nova. */
/* O miolo do cancelamento, sem tocar na tela. Separado de proposito: o pararBuscaDeArquivos
   fecha menu, e fechar menu solta o atalho de volta — em circulo. */
function pararBuscaEmVoo(P) {
  if (!P) return;
  clearTimeout(P._buscaArqTimer);
  P._buscaArqGen = (P._buscaArqGen || 0) + 1;
}
/* R9: o fecharMenus nao reseta o className do .modal-cx, entao a marca "menu-arquivos"
   sobreviveria escondida ali depois de fechado. Por isso ninguem pergunta so' pela classe:
   pergunta se a janelinha esta MESMO na tela, e ainda como menu. */
function menuDeArquivosNaTela(P) {
  const modal = P && P.el && $('.p-modal', P.el);
  if (!modal || modal.classList.contains('hidden') || !modal.classList.contains('como-menu')) return false;
  return !!$('.modal-cx.menu-arquivos', modal);
}
/* Para a busca que ainda esta em voo. Vale nos dois ramos: o relogio e de 140 ms no disco e
   de 450 ms na VPS, e nos dois ele pode acordar depois de o campo ter sido limpo — ai o menu
   de arquivos abriria sozinho por cima do que ja esta acontecendo na tela. */
function pararBuscaDeArquivos(P) {
  if (!P) return;
  pararBuscaEmVoo(P);
  // o "procurando…" pode ja estar na tela: some junto, senao ficava pra sempre
  if (menuDeArquivosNaTela(P)) fecharMenus();
}
/* Solta o atalho de setas do menu de arquivos. Se ficar preso, ele engole o Enter do campo e
   a mensagem nunca e enviada. */
function soltarNavArquivos(P) {
  if (P && P._navArq && P._navArqInp) {
    try { P._navArqInp.removeEventListener('keydown', P._navArq, true); } catch {}
  }
  if (P) { P._navArq = null; P._navArqInp = null; }
}
/* O "@" que pediu esta busca ainda esta no campo, com o mesmo trecho? Entre pedir e responder
   ele pode ter apagado, mandado a mensagem ou trocado de assunto — e ai a lista que volta nao
   e mais resposta a nada, e abrir o menu seria o app se mexendo sozinho. */
function arrobaAindaNoCampo(P, termo) {
  const inp = P && P.el && $('.p-input', P.el);
  if (!inp) return false;
  const v = inp.value;
  const mm = /@([^\s@]*)$/.exec(v.slice(0, inp.selectionStart || v.length));
  return !!mm && mm[1] === termo;
}
/* Uma caixinha de "Arquivos" so' com um recado dentro (procurando / deu erro). Vale so' para
   a VPS: no disco do Mac a lista chega antes de dar tempo de ler. */
function recadoDeArquivos(P, texto, ehErro) {
  const m = novoMenu(P, '.p-input');
  m.classList.add('menu-arquivos');
  m.appendChild(tituloPopup('Arquivos'));
  const s = subPopup(texto);
  if (ehErro) s.classList.add('erro');
  m.appendChild(s);
}
/* A janelinha do painel (.p-modal) e UMA so': o terminal, os conectores, a conta e o diff do
   git moram nela tambem. Uma resposta atrasada da busca so' pode escrever ali se a janelinha
   estiver fechada ou se ainda for menu. Sem esta conferencia ela apagava o conteudo de quem
   tinha ocupado o lugar no meio-tempo. */
function janelinhaOcupada(P) {
  const m = P && P.el && $('.p-modal', P.el);
  if (!m || !m.classList) return false;
  if (m.classList.contains('hidden')) return false;
  return !m.classList.contains('como-menu');
}
async function menuArquivos(P, termo) {
  const remoto = NA_VPS(P.cwd);
  clearTimeout(P._buscaArqTimer);
  const meuGen = (P._buscaArqGen = (P._buscaArqGen || 0) + 1);
  P._buscaArqTimer = setTimeout(async () => {
    if (meuGen !== P._buscaArqGen) return;
    if (!P.el || !P.el.isConnected) return;              // o chat fechou enquanto o relogio corria
    if (janelinhaOcupada(P)) return;
    if (!arrobaAindaNoCampo(P, termo)) return;
    // na VPS a ida e volta demora: avisa que esta procurando, senao parece travado
    if (remoto) recadoDeArquivos(P, 'Procurando os arquivos na VPS…');
    let itens = [], erro = '';
    try {
      // com worktree ativo, o @ tem de buscar na pasta ONDE O MOTOR TRABALHA, nao na principal
      const r = await window.api.buscarArquivos({ cwd: pastaDoWorktree(P), termo });
      /* As DUAS formas, de proposito: a pasta do Mac devolve a lista crua e a da VPS devolve
         { itens, error } — porque falha de rede nao pode virar "essa pasta nao tem arquivo". */
      if (Array.isArray(r)) itens = r;
      else if (r && typeof r === 'object') { itens = Array.isArray(r.itens) ? r.itens : []; erro = r.error || ''; }
    } catch (e) { erro = 'Não consegui buscar os arquivos: ' + ((e && e.message) || e); }
    if (meuGen !== P._buscaArqGen) return;                  // outra tecla ja pediu uma busca mais nova
    if (!P.el || !P.el.isConnected) return;
    if (janelinhaOcupada(P)) return;                     // enquanto o SSH voltava, a janelinha virou outra coisa
    // ele fechou o "procurando…" (Esc, clique fora): a resposta que chega depois nao pode
    // reabrir o menu sozinha
    if (remoto && !menuDeArquivosNaTela(P)) return;
    if (!arrobaAindaNoCampo(P, termo)) { if (menuDeArquivosNaTela(P)) fecharMenus(); return; }
    // rede fora aparece como MOTIVO no lugar da lista; fechar calado parecia travamento
    if (erro) { recadoDeArquivos(P, erro, true); return; }
    if (!itens.length) { if (menuDeArquivosNaTela(P)) fecharMenus(); return; }
    const m = novoMenu(P, '.p-input');
    m.classList.add('menu-arquivos');
    m.appendChild(tituloPopup('Arquivos', 'Escolha para colar o caminho na mensagem.'));
    const corpo = document.createElement('div');
    corpo.className = 'menu-corpo';
    m.appendChild(corpo);
    let sel = 0;
    /* A linha de baixo mostra a PASTA do arquivo a partir da pasta do painel ("renderer/redesign"),
       que é o que separa dois arquivos de mesmo nome. Com o caminho inteiro, os 40 itens
       começavam iguais ("~/Desktop/Projetos-claude/…") e o corte escondia justo a parte que muda.
       Arquivo na raiz mostra o nome da pasta do painel. O caminho inteiro fica no balão do mouse. */
    const raizBusca = String(pastaDoWorktree(P) || '').replace(/\/+$/, '');
    const pastaDoItem = (caminho) => {
      const c = String(caminho || '');
      const rel = raizBusca && c.startsWith(raizBusca + '/') ? c.slice(raizBusca.length + 1) : shortPath(c);
      const i = rel.lastIndexOf('/');
      // o corte fica à ESQUERDA (menus.css: direction rtl), para o fim do caminho aparecer; as
      // marcas LRM seguram "~", "." e ")" das pontas no lugar certo dentro do texto da direita
      return '\u200E' + (i > 0 ? rel.slice(0, i) : (nomePasta(raizBusca) || shortPath(raizBusca))) + '\u200E';
    };
    const pintar = () => {
      corpo.innerHTML = '';
      itens.slice(0, 40).forEach((x, i) => {
        const d = elItem({ ic: 'file', nome: x.nome, desc: pastaDoItem(x.path), dica: shortPath(x.path) }, () => {
          soltarNavArquivos(P);          // escolheu no mouse: solta o atalho tambem
          const inp = $('.p-input', P.el);
          const v = inp.value;
          const cursor = inp.selectionStart || v.length;
          // troca o "@trecho" pelo caminho escolhido
          const antes = v.slice(0, cursor).replace(/@([^\s@]*)$/, '');
          inp.value = antes + x.path + ' ' + v.slice(cursor);
          inp.focus();
          inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
          const fim = (antes + x.path + ' ').length;
          inp.setSelectionRange(fim, fim);
        });
        if (i === sel) d.classList.add('sel');
        corpo.appendChild(d);
      });
    };
    pintar();
    // setas funcionam sem tirar o foco do campo de escrever
    const inp = $('.p-input', P.el);
    soltarNavArquivos(P);                // nunca deixa dois presos ao mesmo tempo
    const nav = (ev) => {
      // menu ja saiu da tela (escolheu no mouse, fechou por fora): se solta
      if (!corpo.isConnected) { soltarNavArquivos(P); return; }
      const vis = [...corpo.querySelectorAll('.mi')];
      if (!vis.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault(); ev.stopPropagation();
        sel = ev.key === 'ArrowDown' ? (sel + 1) % vis.length : (sel <= 0 ? vis.length - 1 : sel - 1);
        pintar(); corpo.children[sel] && corpo.children[sel].scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Enter' && corpo.children[sel]) {
        ev.preventDefault(); ev.stopPropagation();
        corpo.children[sel].click();
        soltarNavArquivos(P);
      } else if (ev.key === 'Escape') {
        /* R8: sem estas duas travas o MESMO Esc fechava o menu aqui e ainda subia para o
           tratador do documento, que mandava PARAR o trabalho da IA. Um aperto, duas coisas,
           e a segunda invisivel — trabalho jogado fora sem ele entender por quê. */
        ev.preventDefault(); ev.stopPropagation();
        pararBuscaEmVoo(P);               // a proxima resposta em voo nao reabre o menu
        fecharMenus(); soltarNavArquivos(P);
      }
    };
    P._navArq = nav; P._navArqInp = inp;
    inp.addEventListener('keydown', nav, true);
    // 140 ms e o tempo de varrer um disco; por SSH cada tecla viraria uma conexao, entao na
    // VPS a espera sobe e a tela avisa que esta procurando
  }, remoto ? 450 : 140);
}

function inserirNoInput(P, txt) {
  const inp = $('.p-input', P.el);
  const sep = inp.value && !inp.value.endsWith(' ') ? ' ' : '';
  inp.value += sep + txt;
  inp.focus();
  inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 190) + 'px';
}

/* ---- as duas unicas portas entre o quadro e o chat ----
   quadro.js e arquivo separado e nao enxerga anexar() nem inserirNoInput(), que sao internas
   daqui. Ele entrega o que produziu; quem mexe no chat continua sendo o app.js. */
window.abrirQuadroAnexar = (P, caminho) => anexar(P, [caminho]);   // devolve Promise: o quadro.js da await
window.abrirQuadroTexto = (P, txt, resumo) => {
  inserirNoInput(P, txt);
  /* O texto do quadro comeca sempre pelo mesmo cabecalho ("Desenhei um fluxograma no quadro…").
     Guardo o que foi colado e o resumo curto do desenho para o nome da aba nao nascer igual
     em todo chat que comeca por um desenho. Quem decide o nome e nomeDaConversa(). */
  P.quadroColado = { texto: txt, resumo: resumo || '' };
};

/* ============ visualizador de arquivo ============ */
/* Redesenho (25/09): o visor e um painel por cima de TODOS os chats (inset 16 40 da area dos
   chats), nao mais uma caixinha presa dentro de um painel. Ele continua morando no .p-visor do
   painel dono (o Esc e o fecharVisor acham por ali); quem o solta do painel e o CSS, com
   position:fixed. So a borda esquerda da area dos chats muda com a coluna lateral aberta ou
   fechada: ela e medida na hora de abrir. Sem DOM de verdade (testes), nao faz nada. */
function posicionarVisor(v) {
  try {
    const area = document.getElementById('panes');
    if (area && v && v.style && v.style.setProperty) v.style.setProperty('--visor-x', Math.round(area.getBoundingClientRect().left) + 'px');
  } catch {}
}
// cabecalho do visor: icone + nome + pasta (em mono). Guardado: o molde antigo nao tinha os dois
function cabecaVisor(v, nome, caminho, icone) {
  const ic = $('.visor-ic', v); if (ic) ic.innerHTML = ico(icone || 'file');
  const cam = $('.visor-caminho', v);
  if (cam) {
    const pasta = caminho ? String(caminho).replace(/\/[^/]*$/, '') : '';
    cam.textContent = pasta ? shortPath(pasta) : '';
    cam.title = caminho || '';
  }
  const n = $('.visor-nome', v); if (n) n.textContent = nome;
}
// escopado ao painel: $$('.p-visor') pegava TODOS os paineis e fechar o visor de um fechava o
// de outro, mesmo os dois com arquivos diferentes abertos ao mesmo tempo (2 paineis lado a lado)
function fecharVisor(P) {
  if (!P || !P.el) return;
  const v = $('.p-visor', P.el); if (!v) return;
  v.classList.add('hidden'); $('.visor-corpo', v).innerHTML = '';
}

/* O recado do visor entra como TEXTO, nunca como HTML: o "a.erro" carrega nome de arquivo
   vindo do statSync, e nome de arquivo pode ter < e > — no innerHTML isso some da tela ou
   vira marcacao. Cada item da lista vira uma linha. */
function recadoVisor(corpo, linhas) {
  corpo.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'visor-vazio';
  linhas.filter(Boolean).forEach((t, i) => {
    if (i) d.appendChild(document.createElement('br'));
    d.appendChild(document.createTextNode(t));
  });
  corpo.appendChild(d);
  return d;
}

async function verArquivo(P, caminho) {
  const v = $('.p-visor', P.el);
  const pedido = {}; v.pedidoArquivo = pedido;
  const corpo = $('.visor-corpo', v);
  posicionarVisor(v);
  v.classList.remove('hidden');
  v.onclick = (e) => { if (e.target === v) fecharVisor(P); };
  $('.visor-nome', v).textContent = caminho.split('/').pop();
  cabecaVisor(v, caminho.split('/').pop(), caminho, 'file');
  $('.visor-x', v).innerHTML = ico('x');
  $('.visor-x', v).onclick = () => fecharVisor(P);
  // no redesenho, "abrir no Mac" é a seta saindo da caixa, com o nome escrito ao lado
  $('.visor-abrir', v).innerHTML = ico('external') + '<span>Abrir no Mac</span>';
  $('.visor-abrir', v).onclick = () => window.api.openPath(caminho);
  // repoe o rotulo: ver um print do agente deixa aqui "nao e' um arquivo no Mac"
  $('.visor-abrir', v).title = 'Abrir no Mac';
  /* Arquivo da VPS nao tem o que abrir no Finder. TOGGLE, nunca add: o visor e o MESMO
     elemento para todos os arquivos daquele painel, e um "add" grudaria o botao escondido
     para sempre no proximo arquivo local. */
  $('.visor-abrir', v).classList.toggle('hidden', NA_VPS(caminho));
  corpo.innerHTML = '<div class="visor-vazio">abrindo…</div>';

  let a;
  try { a = await lerParaVisor(caminho); }
  catch (e) { a = { erro: e.message || 'Falha ao ler o arquivo.' }; }
  if (v.pedidoArquivo !== pedido || v.classList.contains('hidden')) return;
  if (!a || a.erro) { recadoVisor(corpo, ['Não consegui abrir.', (a && a.erro) || '']); return; }
  // o tamanho sai da tela e fica no balao do nome (a tela so tem nome + pasta)
  $('.visor-nome', v).textContent = a.nome;
  $('.visor-nome', v).title = a.nome + '  ·  ' + tamanhoBonito(a.bytes);
  if (a.tipo === 'imagem') { corpo.innerHTML = ''; const i = document.createElement('img'); i.src = a.dados; corpo.appendChild(i); }
  else if (a.tipo === 'texto') {
    /* codigo com o numero da linha na frente. A coluna dos numeros e um <div> (nao <pre>): o
       $('pre') continua achando o texto, e so ele e copiado quando ele seleciona. */
    corpo.innerHTML = '<div class="visor-codigo"><div class="visor-num" aria-hidden="true"></div><pre></pre></div>';
    $('pre', corpo).textContent = a.dados;
    const num = $('.visor-num', corpo);
    if (num) {
      const n = String(a.dados).split('\n').length - (String(a.dados).endsWith('\n') ? 1 : 0);
      num.textContent = Array.from({ length: Math.max(1, n) }, (_, i) => i + 1).join('\n');
    }
  }
  else recadoVisor(corpo, ['Este tipo não abre aqui dentro.', 'Use o botão do canto para abrir no Mac.']);
}

/* ============ conversas recentes ============ */
const histCache = { claude: null, codex: null, acp: null, gemini: null, grok: null };
const leituraHistorico = Object.create(null);

/* As conversas do Claude que rodaram DENTRO da VPS gravam o .jsonl lá, não aqui: elas chegam
   por SSH e ficam num cache PRÓPRIO. Guardar tudo num cache só fazia a lista trocar de dono a
   cada recarga — voltar para uma aba local mostrava "Nenhuma conversa nesta pasta". */
const histCacheVps = { claude: null, codex: null, acp: null, gemini: null, grok: null };
const juntarComVps = (engine, lista) => {
  const vps = histCacheVps[engine];
  if (!vps || !vps.length) return lista;
  return [...lista, ...vps].sort((a, b) => (b.when || 0) - (a.when || 0));
};
/* Busca a lista da VPS por fora, sem segurar a pintura da lista local: se o servidor estiver
   fora do ar, a coluna continua mostrando as conversas do Mac em vez de um erro.
   TRAVA DE TEMPO, e ela é obrigatória: o loadHist roda ao FIM DE CADA RESPOSTA com a coluna
   aberta, e esta busca custa caro — medido em 08/09/2026 contra a VPS dele: 1,5 s e 11 MB
   (cabeça e cauda de 80 conversas). Sem a trava, cada resposta puxava 11 MB pela internet. */
const VPS_ESPERA = 90000;
const vpsBuscadoEm = { claude: 0, codex: 0, acp: 0, gemini: 0, grok: 0 };
let vpsBuscando = false;
let vpsUltimoErro = '';
async function buscarConversasVps(engine, force) {
  if (engine !== 'claude' || !window.api.sessionsClaudeRemoto) return;
  // sem nenhuma aba na VPS não se gasta uma conexão SSH para nada
  if (![...abas.values()].some(A => NA_VPS(A.cwd))) {
    /* fechou a última aba da VPS: a lista dela sai da coluna junto. Sem isto as conversas
       remotas ficavam listadas (com o rótulo mentindo) até ele reiniciar o app. */
    if (histCacheVps[engine]) {
      histCacheVps[engine] = null;
      histCache[engine] = (histCache[engine] || []).filter(s => !s.remoto);
      pintarConversas();
    }
    return;
  }
  if (vpsBuscando) return;
  if (!force && Date.now() - vpsBuscadoEm[engine] < VPS_ESPERA) return;
  vpsBuscadoEm[engine] = Date.now();
  vpsBuscando = true;
  let r = null;
  try { r = await window.api.sessionsClaudeRemoto(!!cfg.verRobos); } catch { return; }
  finally { vpsBuscando = false; }
  /* A frase do motivoDoSsh só serve se ele a VIR: sem isto, VPS fora do ar = as conversas dela
     somem da coluna e ninguém diz por quê. avisoTemp e não note por causa da R4.
     Uma vez por queda: esta busca volta a cada resposta e o mesmo recado de 90 em 90 segundos
     vira barulho. Se o erro mudar, ou depois de uma busca boa, ele avisa de novo. */
  if (r && r.error) {
    const P = focusPane;
    if (P && r.error !== vpsUltimoErro) { vpsUltimoErro = r.error; avisoTemp(P, 'Conversas da VPS: ' + r.error); }
    return;
  }
  if (!Array.isArray(r)) return;               // erro do servidor não apaga o que já está na tela
  vpsUltimoErro = '';
  histCacheVps[engine] = r;
  histCache[engine] = juntarComVps(engine, (histCache[engine] || []).filter(s => !s.remoto));
  pintarConversas();
}

function grupoDoTempo(ms) {
  if (!ms) return 'Sem data';
  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  const d = ms;
  if (d >= hoje) return 'Hoje';
  if (d >= hoje - 86400000) return 'Ontem';
  if (d >= hoje - 7 * 86400000) return 'Últimos 7 dias';
  if (d >= hoje - 30 * 86400000) return 'Últimos 30 dias';
  const dt = new Date(d);
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return meses[dt.getMonth()] + (dt.getFullYear() !== agora.getFullYear() ? ' de ' + dt.getFullYear() : '');
}

/* Tempo da linha da lista de conversas (redesenho 25/09): "agora", "12 min", "3 h", "ontem",
   "4 d" — curto, à direita do título. O corte de dia é o mesmo do grupoDoTempo, para o "ontem"
   da linha bater com o grupo "Ontem" em cima dela. O quando() continua nas frases ("há 3h"). */
function quandoCurto(ms) {
  if (!ms) return '';
  const min = Math.floor(Math.max(0, Date.now() - ms) / 60000);
  if (min < 1) return 'agora';
  const meiaNoite = (x) => { const d = new Date(x); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const hoje = meiaNoite(Date.now());
  if (ms >= hoje) return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h';
  const dias = Math.round((hoje - meiaNoite(ms)) / 86400000);
  return dias <= 1 ? 'ontem' : dias + ' d';
}
// "há 5 min" / "agora há pouco", para dizer de quando e um numero guardado
function haQuanto(ms) { const q = quando(ms); return q === 'agora' ? 'agora há pouco' : 'há ' + q; }
function quando(ms) {
  if (!ms) return '';
  const d = Math.max(0, Date.now() - ms);
  const min = Math.round(d / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return h + 'h';
  const dias = Math.round(h / 24);
  return dias + (dias === 1 ? ' dia' : ' dias');
}

/* Teste unico e certo de "a lista de conversas esta na frente dele".
   O que ganha 'hidden' quando a coluna fecha e o #sidebar; a .side-view do Claude nunca
   nascia com 'hidden', entao o teste antigo dava SEMPRE verdadeiro e o app relia milhares de
   arquivos de conversa a cada resposta, mesmo com a coluna fechada. Era a engasgada de todo
   fim de resposta. */
/* 25/09: o motor nao importa mais — a lista e uma so para todas as IAs. O argumento ficou para
   quem chama nao precisar mudar: "a lista esta aberta?" vale igual para qualquer motor. */
function lateralAberta() {
  // no telefone a lateral e uma gaveta por cima: quem diz se esta aberta e a classe do body,
  // porque o #sidebar nunca ganha 'hidden'. Sem isto o telefone relia a lista a cada resposta.
  if (window.SEM_ELECTRON) { if (!document.body.classList.contains('gaveta')) return false; }
  else if ($('#sidebar').classList.contains('hidden')) return false;
  const v = $('.side-view[data-view="conversas"]');
  return !!v && !v.classList.contains('hidden');
}

/* 25/09: a lista de UMA IA que nao veio (app-server do Codex fora do ar, arquivo ilegivel). Na
   coluna por motor a caixa dizia "Não consegui ler"; na lista unica, trocar tudo pelo erro
   apagaria as conversas das outras IAs, e calar fazia as do Codex sumirem sem aviso. Fica uma
   linha curta no topo: logo + "indisponível" (o motivo no title), e o clique tenta de novo. */
const erroDaLista = {};
function pintarErrosDaLista() {
  const cx = $('#cvErros');
  if (!cx) return;
  cx.replaceChildren();
  for (const m of MOTORES) {
    // IA que nem esta instalada neste Mac nao tem lista para dar erro
    if (!erroDaLista[m] || (MOTORES_OK && MOTORES_OK[m] === false)) continue;
    const b = document.createElement('button');
    b.className = 'cv-erro';
    b.dataset.motor = m;
    b.title = 'Não consegui ler as conversas do ' + nomeDoMotor(m) + ': ' + erroDaLista[m] + '\nClique para tentar de novo.';
    b.innerHTML = '<span class="cv-uso-logo">' + svgMotor(m) + '</span><span>indisponível</span>';
    b.addEventListener('click', () => loadHist(m, true));
    cx.appendChild(b);
  }
}

async function loadHist(engine, force) {
  const pedido = leituraHistorico[engine] = (leituraHistorico[engine] || 0) + 1;
  const box = caixaHist();
  /* 25/09: a caixa e de TODOS os motores. "Carregando…" e o erro de leitura so ocupam a caixa
     quando nenhum motor tem lista ainda: o Gemini fora do ar nao pode apagar as do Claude. */
  const algumaPronta = () => MOTORES.some(m => Array.isArray(histCache[m]));
  if (algumaPronta()) pintarConversas();   // mostra o que ja tem
  else if (box) box.innerHTML = '<div class="hist-load">Carregando…</div>';
  /* [EDITA leva 12.4] uma alternativa NOVA na frente das duas de sempre, que ficaram intactas:
     as conversas do ACP são as que o próprio Cockpit anota, num JSONL por sessão. */
  let r;
  try {
    r = ['gemini', 'grok'].includes(engine) ? await window.api.sessionsCli(engine)
      : engine === 'acp' ? await window.api.sessionsAcp()
      : engine === 'claude' ? await window.api.sessionsClaude(!!cfg.verRobos) : await window.api.sessionsCodex(!!cfg.verRobos);
    if (r && r.error) throw new Error(r.error);
    if (r && !Array.isArray(r)) throw new Error('A lista de conversas está indisponível.');
  } catch (e) {
    if (leituraHistorico[engine] !== pedido) return;
    if (box && !algumaPronta()) box.replaceChildren(Object.assign(document.createElement('div'),
      { className: 'hist-load', textContent: 'Não consegui ler: ' + (e.message || e) }));
    // com a lista das outras IAs na tela, a falha desta vira uma linha curta no topo
    erroDaLista[engine] = String((e && e.message) || e || 'sem resposta');
    pintarErrosDaLista();
    return;
  }
  if (leituraHistorico[engine] !== pedido) return;
  if (erroDaLista[engine]) { delete erroDaLista[engine]; pintarErrosDaLista(); }
  histCache[engine] = juntarComVps(engine, r || []);
  pintarConversas();
  /* de propósito SEM o `force`: o turn-end também chama loadHist(engine, true), então passar
     o force adiante desligaria a trava justamente onde ela é necessária */
  buscarConversasVps(engine);   // as da VPS entram depois, sem segurar esta pintura
}

// a chave 'todas' e a da lista unica (25/09); as dos motores ficaram para nada quebrar
const buscaAtual = { claude: '', codex: '', acp: '', gemini: '', grok: '', todas: '' };
// filtro de pasta da lista lateral: '' = Mac inteiro, 'ABA' = acompanha a aba, ou o caminho de um cliente
const filtroPasta = { claude: 'ABA', codex: 'ABA', acp: 'ABA', gemini: 'ABA', grok: 'ABA', todas: 'ABA' };

// cada pasta dentro daqui e um cliente (funcao porque o HOME so chega no boot)
const PROJETOS = () => HOME + '/Desktop/Projetos-claude';

// sem cache de proposito: cliente novo aparece na hora que a pasta e criada
async function lerClientes() {
  if (!window.api || !window.api.listDir) return [];
  try {
    const r = await window.api.listDir(PROJETOS());
    return (r && r.entries) ? r.entries.filter(e => e.dir).map(e => ({ nome: e.name, path: e.path })) : [];
  } catch { return []; }
}

// o caminho esta dentro da pasta alvo (ou e ela mesma)?
function dentroDe(cwd, alvo) {
  if (!cwd || !alvo) return false;
  return cwd === alvo || cwd.startsWith(alvo.replace(/\/+$/, '') + '/');
}
/* De qualquer caminho, descobre de qual cliente ele e — e o que define em qual aba a conversa
   mora. Uma subpasta do cliente (Adsure/paginas/checkout) continua sendo Adsure, senao cada
   subpasta abria uma aba nova e a lista lateral nao achava nada.
   Pasta fora de Projetos-claude devolve ela mesma, e nao vazio: vazio queria dizer "Mac
   inteiro", entao uma aba dessas despejava TODAS as conversas do computador na lista. */
function clienteDe(cwd) {
  const raiz = PROJETOS();
  if (!dentroDe(cwd, raiz)) return cwd || '';
  const primeiro = cwd.slice(raiz.length + 1).split('/').filter(Boolean)[0];
  return primeiro ? raiz + '/' + primeiro : raiz;
}
// a aba onde este caminho deve morar: a do cliente dele. Cria se ainda nao existir.
function abaDoCaminho(cwd, criar) {
  const alvo = clienteDe(cwd);
  const achada = [...abas.values()].find(x => clienteDe(x.cwd) === alvo);
  if (achada) return achada;
  return criar ? novaAbaProjeto(alvo || cwd) : null;
}

function pastaDoFiltro(engine) {
  const f = filtroPasta[engine];
  if (f === 'ABA') return abaAtiva ? clienteDe(abaAtiva.cwd) : '';
  return f;
}
function filtrarPorPasta(engine, lista) {
  const alvo = pastaDoFiltro(engine);
  if (!alvo) return lista;
  return lista.filter(s => dentroDe(s.cwd, alvo));
}

/* Todas as conversas do Mac, dos quatro motores juntos e sem filtro de pasta: e nesta lista
   que a busca procura. Tira repetida (a mesma conversa pode chegar pelo cache local e pela
   copia da VPS) e devolve da mais nova para a mais velha. */
function todasAsConversas() {
  const vistas = new Set();
  const tudo = [];
  for (const m of MOTORES) {
    for (const s of (histCache[m] || [])) {
      // por arquivo, nao so por id: o Codex repete o mesmo id em varias .jsonl, e cada uma e'
      // uma conversa real — dedup so por id derrubava as outras da busca
      const k = (s.engine || m) + ':' + s.id + ':' + (s.file || '');
      if (vistas.has(k)) continue;
      vistas.add(k);
      tudo.push(s);
    }
  }
  return tudo.sort((a, b) => (b.when || 0) - (a.when || 0));
}

/* ============ conversa costurada: uma conversa, varias IAs (25/09) ============
   Trocar de IA no meio do chat faz o motor novo abrir OUTRA conversa no armazenamento dele.
   O main guarda em ligacoes.json, para cada conversa que nasceu de uma troca, qual era a parte
   anterior. Aqui a lista junta as partes: a parte que e "anterior" de outra nao aparece
   sozinha, o item mostrado e a parte MAIS NOVA, com o nome da cadeia, a data da mais nova e o
   logo de cada IA que trabalhou nela. Abrir o item traz o historico de todas as partes. */
let LIGACOES = {};           // "motor:id da nova" -> { engine, id, file, cwd, anterior: {…} }
let NOMES_LIGADOS = {};      // id -> nome salvo (nomes.json) das partes que estao em alguma cadeia
const chaveParte = (p) => (p && p.engine) + ':' + (p && p.id);
// so o que identifica a parte: o resto (titulo, data) muda e nao vai para o ligacoes.json
const refDaParte = (p) => ({ engine: p.engine, id: p.id, file: p.file || '', cwd: p.cwd || '', remoto: !!p.remoto });

async function lerLigacoes() {
  if (!window.api || !window.api.ligacoesLer) return;
  let r = null;
  try { r = await window.api.ligacoesLer(); } catch { return; }   // sem resposta: fica o que ja tinha
  if (!r || typeof r !== 'object' || r.error) return;
  LIGACOES = (r.ligacoes && typeof r.ligacoes === 'object') ? r.ligacoes : {};
  NOMES_LIGADOS = (r.nomes && typeof r.nomes === 'object') ? r.nomes : {};
}

// a ligacao em que esta parte e a NOVA (quem veio antes dela). So motor+id: o Codex pode ter
// o mesmo id em mais de uma .jsonl, e todas continuam a mesma conversa de antes da troca.
function ligacaoDe(p) {
  const l = LIGACOES[chaveParte(p)];
  return l && l.anterior && l.anterior.id ? l : null;
}

/* As partes de uma conversa, da mais velha para a mais nova, andando pelas ligacoes a partir
   de uma parte qualquer. Para em ciclo (A→B→A, arquivo editado na mao) e em 50 passos. */
function partesDaCadeia(ref) {
  const partes = [ref];
  const vistos = new Set([chaveParte(ref)]);
  let atual = ref;
  for (let n = 0; n < 50; n++) {
    const l = ligacaoDe(atual);
    if (!l) break;
    const k = chaveParte(l.anterior);
    if (vistos.has(k)) break;
    vistos.add(k);
    partes.unshift(l.anterior);
    atual = l.anterior;
  }
  return partes;
}

/* Titulo da cadeia: o nome salvo de qualquer parte, da mais nova para a mais velha (o nome
   que ele deu, ou o nome curto, vale para a conversa inteira); sem nome salvo, o titulo da
   primeira parte — que e o pedido de verdade, e nao o "Estou continuando uma conversa…". */
function tituloDaCadeia(partes) {
  for (let i = partes.length - 1; i >= 0; i--) if (NOMES_LIGADOS[partes[i].id]) return NOMES_LIGADOS[partes[i].id];
  const primeira = partes.find(p => !p.fantasma && p.title);
  return (primeira && primeira.title) || partes[partes.length - 1].title || 'Conversa';
}
// as IAs da conversa na ordem em que entraram, sem repetir
function motoresDaCadeia(partes) {
  const out = [];
  for (const p of partes) if (p && p.engine && !out.includes(p.engine)) out.push(p.engine);
  return out;
}
function itemDaCadeia(partes) {
  const cabeca = partes[partes.length - 1];
  if (partes.length === 1) return cabeca;
  return Object.assign({}, cabeca, {
    title: tituloDaCadeia(partes),
    when: Math.max(...partes.map(p => p.when || 0)),
    partes, motores: motoresDaCadeia(partes),
    remoto: partes.some(p => p.remoto),
  });
}

/* A lista unica: as conversas de todas as IAs, com as cadeias ja juntadas. Cada parte que e
   anterior de uma conversa que existe na lista sai de circulacao sozinha. Parte apagada no
   meio da cadeia (arquivo sumiu por fora) vira "fantasma": a cadeia continua andando por ela
   pela ligacao, e o historico dela simplesmente nao vem. */
function montarCadeias(lista) {
  const porId = new Map();
  for (const s of lista) {
    const k = chaveParte(s);
    if (!porId.has(k)) porId.set(k, []);
    porId.get(k).push(s);
  }
  // Codex repete o mesmo id em varias .jsonl (ver chaveFav): com mais de uma, vale a do arquivo
  const acharItem = (ref) => {
    const xs = porId.get(chaveParte(ref));
    if (!xs) return null;
    if (xs.length === 1) return xs[0];
    return ref.file ? (xs.find(x => (x.file || '') === ref.file) || null) : xs[0];
  };
  const montar = (cabeca) => {
    const partes = partesDaCadeia(cabeca).map((p, i, todas) => {
      if (i === todas.length - 1) return cabeca;
      return acharItem(p) || Object.assign({}, refDaParte(p), { fantasma: true });
    });
    return partes;
  };
  // quem e anterior de alguem que EXISTE (andando tambem pelos fantasmas): nao e cabeca
  const anteriores = new Set();
  for (const s of lista) {
    if (!ligacaoDe(s)) continue;
    for (const p of montar(s).slice(0, -1)) if (!p.fantasma && p !== s) anteriores.add(p);
  }
  const absorvidos = new Set();
  const out = [];
  const juntar = (s) => {
    const partes = montar(s);
    for (const p of partes) if (!p.fantasma) absorvidos.add(p);
    out.push(itemDaCadeia(partes));
  };
  for (const s of lista) if (!anteriores.has(s)) juntar(s);
  // sobrou alguem que nao e cabeca nem foi juntado: so acontece em ciclo (A→B→A). A mais nova
  // vira a cabeca, e nenhuma conversa some da lista por causa de uma costura torta.
  for (const s of lista) if (!absorvidos.has(s)) juntar(s);
  return out.sort((a, b) => (b.when || 0) - (a.when || 0));
}
function listaUnica() { return montarCadeias(todasAsConversas()); }
// de cada parte (e de cada conversa solta) para o item que a lista mostra: e o que leva o
// achado da busca numa parte velha para a conversa inteira
function mapaDasCadeias(lista) {
  const m = new Map();
  for (const c of (lista || [])) {
    m.set(c, c);
    if (Array.isArray(c.partes)) for (const p of c.partes) if (!p.fantasma) m.set(p, c);
  }
  return m;
}

/* Desenha a lista unica. Quem mudou alguma coisa (lista nova de um motor, estrela, grupo,
   filtro, busca) chama esta, e nunca mais o paintHist de um motor so. */
function pintarConversas() { return paintHist(VISTA_CONVERSAS, listaUnica()); }

/* O ACP (Qwen, OpenCode…) nao tem botao na barra, mas as conversas dele sao do proprio Cockpit
   e entram na lista unica tambem: antes o ⌘P com um chat ACP em foco abria a coluna dele, e sem
   ler aqui elas sumiam da lista e da busca (e a parte ACP de uma cadeia virava fantasma). E
   barato: e um JSONL por sessao que o Cockpit mesmo grava. */
const MOTORES_DA_LISTA = [...MOTORES_VISIVEIS, 'acp'];
let costuraAntigaPedida = false;
/* Le as conversas de todas as IAs e a costura entre elas. As listas chegam cada uma no seu
   tempo (o Codex demora mais): a lista vai se completando, cada chegada redesenha. */
async function recarregarConversas(forcar) {
  await lerLigacoes();
  await Promise.all(MOTORES_DA_LISTA.map(m => loadHist(m, forcar).catch(() => {})));
  /* Uma vez por abertura do app: as conversas partidas numa troca de IA ANTES da costura
     existir sao ligadas pelo main (so trabalha na primeira vez de todas; depois responde na
     hora). Achou alguma: a lista relê a costura e junta os pedacos. So no Mac (o preload). */
  if (!costuraAntigaPedida && window.api && window.api.ligacoesAntigas) {
    costuraAntigaPedida = true;
    Promise.resolve(window.api.ligacoesAntigas()).then(async (r) => {
      if (!r || !r.novas) return;
      await lerLigacoes();
      if (lateralAberta()) pintarConversas();
    }).catch(() => {});
  }
}

// os logos oficiais das IAs da conversa, 12px, cada um na cor da sua IA
function logosDaConversa(s) {
  const motores = Array.isArray(s.motores) && s.motores.length ? s.motores : [s.engine];
  const cx = document.createElement('span');
  cx.className = 'hi-motores';
  cx.title = motores.map(nomeDoMotor).join(' → ');
  for (const m of motores) {
    const l = document.createElement('span');
    l.className = 'hi-motor';
    l.dataset.motor = m;
    l.innerHTML = svgMotor(m);
    cx.appendChild(l);
  }
  return cx;
}

// nome novo dado pela lista ou pelo lapis do chat: vale na hora para a linha e para a cadeia
function lembrarNomeDaParte(p, nome) {
  if (!p || !p.id || !nome) return;
  if (Array.isArray(histCache[p.engine])) {
    for (const x of histCache[p.engine]) if (x.id === p.id && (!p.file || !x.file || x.file === p.file)) x.title = nome;
  }
  if (Object.values(LIGACOES).some(l => (l.engine === p.engine && l.id === p.id) || (l.anterior.engine === p.engine && l.anterior.id === p.id))) {
    NOMES_LIGADOS[p.id] = nome;
  }
  // o nome curto chega a cada 2a/4a/8a mensagem: com a lateral fechada nao ha o que redesenhar
  if (lateralAberta()) pintarConversas();
}
// parte que foi para a Lixeira: a costura dela sai tambem da memoria desta tela
function esquecerLigacoesLocais(p) {
  for (const [k, l] of Object.entries(LIGACOES)) {
    if ((l.engine === p.engine && l.id === p.id) || (l.anterior.engine === p.engine && l.anterior.id === p.id)) delete LIGACOES[k];
  }
  delete NOMES_LIGADOS[p.id];
}

/* ---- o painel e a cadeia ----
   P.parteAnterior: a conversa de ANTES da ultima troca de IA, esperando o motor novo abrir a
   dele para costurar. P.partesAnteriores: todas as partes mais velhas desta conversa. */
function esquecerCadeiaDoPainel(P) { P.parteAnterior = null; P.partesAnteriores = []; }
/* Chamado no instante da troca de IA, ANTES de o numero da conversa ser zerado. Chat sem
   conversa (trocou duas vezes sem mandar nada) nao guarda nada: a parte pendente continua a
   mesma, e nao nasce ligacao fantasma. */
function guardarParteAnterior(P) {
  /* Ramo que ainda nao mandou a 1a mensagem (forkPendente): o resumeId dele e o da conversa de
     ORIGEM, porque o fork so acontece no start. Guardar aqui costurava o ramo na origem — que
     continua viva no outro chat e sumia da lista como item proprio (e o Apagar do ramo levava
     a origem junto para a Lixeira). */
  if (P.forkPendente) return;
  const id = P.sessaoId || P.resumeId;
  if (!id) return;
  /* Sem nada na tela o motor novo nao recebe contexto nenhum (o passarContexto sai do P.hist):
     nao e continuacao, e costurar juntaria duas conversas que nao se conhecem. */
  if (!Array.isArray(P.hist) || !P.hist.length) return;
  P.parteAnterior = { engine: P.engine, id, file: P.sessaoFile || '', cwd: P.cwd || '' };
}
/* O motor novo anunciou a conversa dele (evento 'sessao'): costura nova → anterior no disco. */
function ligarParteAnterior(P) {
  const anterior = P.parteAnterior;
  if (!anterior || !P.sessaoId) return;
  P.parteAnterior = null;
  const nova = { engine: P.engine, id: P.sessaoId, file: P.sessaoFile || '', cwd: P.cwd || '' };
  // retomou a mesma conversa (nada mudou de verdade): nao ha o que costurar
  if (anterior.engine === nova.engine && anterior.id === nova.id) return;
  // a cadeia ja passa pela nova: ligar faria um circulo
  if (partesDaCadeia(anterior).some(p => p.engine === nova.engine && p.id === nova.id)) return;
  P.partesAnteriores = [...(P.partesAnteriores || []), anterior];
  // vale na hora nesta tela; o main e quem guarda de verdade (e tambem recusa circulo)
  LIGACOES[chaveParte(nova)] = Object.assign({}, nova, { anterior, quando: Date.now() });
  Promise.resolve(window.api.ligacoesGravar ? window.api.ligacoesGravar({ nova, anterior }) : null)
    .then(r => { if (r && r.error) delete LIGACOES[chaveParte(nova)]; })
    .catch(() => {});
  if (lateralAberta()) pintarConversas();
}

/* O historico de UMA parte. Conversa do Claude que rodou na VPS mora no disco de la. */
async function lerHistoricoDaParte(p) {
  const remoto = p.engine === 'claude' && (!!p.remoto || NA_VPS(p.cwd)) && window.api.sessionHistoryRemoto;
  const msgs = remoto
    ? await window.api.sessionHistoryRemoto({ id: p.id })
    : await window.api.sessionHistory({ engine: p.engine, file: p.file, id: p.id, cwd: p.cwd });
  if (!Array.isArray(msgs)) throw new Error(msgs && (msgs.error || msgs.erro) || 'Histórico indisponível.');
  return msgs;
}
// todas as partes em paralelo (a VPS lenta nao segura as do Mac); uma que falha nao derruba
// as outras — ela volta com o erro e as demais sao desenhadas
function lerPartes(partes) {
  return Promise.all(partes.map(p => lerHistoricoDaParte(p)
    .then(msgs => ({ parte: p, msgs }), erro => ({ parte: p, msgs: [], erro }))));
}
/* Desenha as partes da mais velha para a mais nova, com a faixa da troca de IA entre elas.
   Cada resposta sai com o logo e o nome da IA QUE respondeu, e entra no P.hist com esse nome:
   se ele trocar de novo, a proxima IA recebe "### Codex:" e "### Claude:" certos.
   A troca do P.engine durante o desenho e sincrona de proposito: nenhum evento do motor entra
   no meio, e o finally devolve o motor do painel mesmo se uma mensagem estourar. */
function desenharPartes(P, lidas) {
  const motorDoPainel = P.engine;
  let antes = '', desenhou = 0;
  try {
    for (const { parte, msgs } of lidas) {
      if (!msgs || !msgs.length) continue;
      if (antes && antes !== parte.engine) marcaTroca(P, nomeDoMotor(antes), nomeDoMotor(parte.engine));
      P.engine = parte.engine;
      for (const m of msgs) renderizarHistorico(P, m);
      antes = parte.engine;
      desenhou += msgs.length;
    }
  } finally { P.engine = motorDoPainel; }
  return desenhou;
}

/* A busca olha os quatro motores, mas a lista de cada motor so e lida quando a coluna dele
   abre. Antes de procurar, le as que ainda faltam — uma vez so — e redesenha quando chegam. */
let lendoTodoHistorico = false;
// motor que ja foi pedido uma vez nao e pedido de novo a cada letra digitada, mesmo que a
// leitura tenha falhado (motor que nao esta instalado neste Mac cai aqui)
const historicoJaPedido = new Set();
async function lerHistoricoDeTodosOsMotores(engine) {
  if (lendoTodoHistorico) return;
  const faltam = MOTORES_DA_LISTA.filter(m => !histCache[m] && !historicoJaPedido.has(m));
  if (!faltam.length) return;
  lendoTodoHistorico = true;
  for (const m of faltam) historicoJaPedido.add(m);
  try { await Promise.all(faltam.map(m => loadHist(m).catch(() => {}))); } catch {}
  lendoTodoHistorico = false;
  pintarConversas();   // agora com todas na mao
}

function pintarBotaoFiltro(engine) {
  const bt = $('.side-filtro[data-filtro="' + engine + '"]');
  if (!bt) return;
  /* Digitando, a busca olha o Mac inteiro e os quatro motores: o botao tem de DIZER isso.
     Senao a tela mostra "Pedro" enquanto a lista embaixo traz conversa de todo mundo. */
  const buscando = !!(buscaAtual[engine] || '').trim();
  const alvo = buscando ? '' : pastaDoFiltro(engine);
  $('.sf-txt', bt).textContent = alvo ? nomeProjeto(alvo) : 'Mac inteiro';
  bt.classList.toggle('on', !!alvo);
}
// a lista do filtro: Mac inteiro, acompanhar a aba, e um item por cliente
async function pintarPastas(engine) {
  const cx = $('.side-pastas[data-pastas="' + engine + '"]');
  if (!cx) return;
  const lista = listaUnica();   // 25/09: a contagem por cliente e das conversas de todas as IAs
  const clientes = await lerClientes();
  const f = filtroPasta[engine];
  const daAba = abaAtiva ? clienteDe(abaAtiva.cwd) : '';
  cx.innerHTML = '';
  const item = (rotulo, valor, extra, ligado) => {
    const b = document.createElement('button');
    b.className = 'sp-item' + (ligado ? ' on' : '');
    b.innerHTML = '<span class="sp-n"></span><span class="sp-q"></span>';
    $('.sp-n', b).textContent = rotulo;
    $('.sp-q', b).textContent = extra || '';
    b.onclick = () => {
      filtroPasta[engine] = valor;
      cx.classList.add('hidden');
      pintarBotaoFiltro(engine);
      pintarConversas();
    };
    cx.appendChild(b);
  };
  item('Mac inteiro', '', String(lista.length), f === '');
  item('Acompanha a aba' + (daAba ? ' · ' + nomeProjeto(daAba) : ''), 'ABA', '', f === 'ABA');
  for (const c of clientes) {
    const n = lista.filter(s => dentroDe(s.cwd, c.path)).length;
    item(c.nome, c.path, String(n), f === c.path);
  }
}

// a coluna lateral acompanha a pasta da aba aberta
function lateralSegueAPasta() {
  // 25/09: uma lista so. Acompanhando a aba, o botao e a lista trocam junto com a pasta.
  if (filtroPasta[VISTA_CONVERSAS] !== 'ABA') return;
  pintarBotaoFiltro(VISTA_CONVERSAS);
  pintarConversas();
}

// R3-037: inclui o arquivo — Codex repete o mesmo id em .jsonl diferentes (conversas distintas);
// sem o arquivo, apagar uma tirava o favorito/grupo da irmã que continua viva.
const chaveFav = (s) => s.engine + ':' + s.id + ':' + (s.file || '');
/* 25/09: a conversa costurada (troca de IA no meio) tem varias partes. A estrela e o grupo
   ficam no ITEM da cadeia: valem se estiverem em qualquer parte (a estrela dada antes da troca
   ficou gravada na parte velha) e, ao mexer, vao para a parte mais nova — que e a que a lista
   mostra. Assim nenhuma parte velha volta a aparecer solta por causa de uma estrela antiga. */
const chavesDaConversa = (s) => (Array.isArray(s.partes) && s.partes.length ? s.partes : [s]).map(chaveFav);
const ehFavorita = (s) => Array.isArray(cfg.favoritos) && chavesDaConversa(s).some(k => cfg.favoritos.includes(k));
function trocarFavorita(s) {
  if (!Array.isArray(cfg.favoritos)) cfg.favoritos = [];
  const chaves = chavesDaConversa(s);
  if (chaves.some(k => cfg.favoritos.includes(k))) cfg.favoritos = cfg.favoritos.filter(k => !chaves.includes(k));
  else cfg.favoritos.unshift(chaveFav(s));
  window.api.setConfig(cfg);
}

/* O trecho da busca "dentro da conversa" vem do main com ~45 letras ANTES da palavra achada. Na
   coluna cabem umas 35 numa linha de 11px: as reticências cortavam antes da palavra e a marca
   amarela nunca aparecia. Aqui a frente encolhe para as últimas palavras antes dela (até ~16
   letras), para a marca cair no começo da linha. Sem achar a palavra, o trecho fica como veio. */
function trechoPerto(trecho, termo) {
  const t = String(trecho || '');
  const i = termo ? t.toLowerCase().indexOf(termo) : -1;
  if (i <= 18) return t;
  // começa numa palavra inteira dentro das ~16 letras de antes; palavra comprida corta nela mesmo
  let de = i - 16;
  const sp = t.indexOf(' ', de);
  if (sp >= 0 && sp < i) de = sp + 1;
  return '…' + t.slice(de);
}
function marcarTermo(el, texto, termo) {
  el.textContent = '';
  const i = termo ? texto.toLowerCase().indexOf(termo) : -1;
  if (i < 0) { el.textContent = texto; return; }
  el.appendChild(document.createTextNode(texto.slice(0, i)));
  const m = document.createElement('span'); m.className = 'hi-marca';
  m.textContent = texto.slice(i, i + termo.length);
  el.appendChild(m);
  el.appendChild(document.createTextNode(texto.slice(i + termo.length)));
}

/* ---- conversa que esta aberta em algum chat ganha borda da cor do motor ----
   laranja = Claude, azul = Codex. Fechou o chat, a borda some. A cor vem do motor do CHAT
   (e nao do item da lista) porque o painel pode ter trocado de motor no meio do caminho. */
function motorQueAbriu(id, arquivo) {
  if (!id) return null;
  for (const P of panes.values()) {
    /* 25/09: chat que acabou de trocar de IA e ainda nao mandou nada continua sendo o dono da
       conversa de antes — a lista marca ela como aberta ate o motor novo abrir a dele */
    const pendente = P.parteAnterior && P.parteAnterior.id === id && !(P.parteAnterior.file && arquivo && P.parteAnterior.file !== arquivo);
    if (P.resumeId !== id && P.sessaoId !== id && !pendente) continue;
    if (pendente) return P.engine;
    // O Codex repete o MESMO numero de conversa em varios arquivos (cada vez que ela e
    // retomada nasce outro). So pelo numero, abrir uma acendia a borda de 17 linhas iguais.
    if (P.sessaoFile && arquivo && P.sessaoFile !== arquivo) continue;
    return P.engine;
  }
  return null;
}
function pintarAberta(d) {
  const eng = motorQueAbriu(d.dataset.sid, d.dataset.sfile);
  d.classList.toggle('aberta', !!eng);
  /* 26/09: "selecionada" (fundo e negrito, como no desenho) é UMA só: a conversa do chat em
     foco. Com o destaque em toda conversa aberta, três ou quatro chats na tela acendiam três ou
     quatro linhas iguais e nenhuma dizia qual ele estava olhando. Mesma regra do motorQueAbriu
     (número da conversa e, no Codex, o arquivo), só que olhando o chat em foco. */
  const F = focusPane, sid = d.dataset.sid, arq = d.dataset.sfile;
  d.classList.toggle('no-foco', !!eng && !!F && !!sid && (F.resumeId === sid || F.sessaoId === sid)
    && !(F.sessaoFile && arq && F.sessaoFile !== arq));
  d.classList.toggle('ab-claude', eng === 'claude');
  d.classList.toggle('ab-codex', eng === 'codex');
  for (const e of ['gemini', 'grok']) d.classList.toggle('ab-' + e, eng === e);
  d.classList.toggle('ab-acp', eng === 'acp');   // leva 12.4: a moldura da conversa aberta
}
function marcarAbertas() {
  document.querySelectorAll('.hist-item[data-sid]').forEach(pintarAberta);
}

/* ============ janelinha e menu GLOBAIS (leva 8.1) ============
   A lista lateral de conversas não pertence a nenhum chat: uma janelinha de dentro do painel
   (.p-modal) ficaria presa dentro de um deles e sumiria ao trocar de aba. Estes dois vivem no
   body, por cima de tudo, e são fechados por listeners NOVOS em captura (logo abaixo). */
let aoFecharModalGlobal = null;
function abrirModalGlobal() {
  aoFecharModalGlobal = null;
  const modal = $('#modalGrupo'); if (!modal) return document.createElement('div');
  const cx = $('.modal-cx', modal);
  cx.className = 'modal-cx';   // R9: limpa marca de uso anterior, senão a próxima sai deformada
  modal.classList.remove('hidden');
  modal.onclick = (e) => { if (e.target === modal) fecharModalGlobal(); };
  cx.onclick = (e) => e.stopPropagation();
  cx.innerHTML = '';
  return cx;
}
function fecharModalGlobal() {
  const f = aoFecharModalGlobal; aoFecharModalGlobal = null;
  if (f) { try { f(); } catch {} }
  const modal = $('#modalGrupo'); if (!modal) return;
  modal.classList.add('hidden');
  $('.modal-cx', modal).innerHTML = '';
}
function fecharPopGlobal() {
  const pop = $('#popGrupo'); if (!pop) return;
  // redesenho 26/09: esmaece em 120ms numa cópia solta; o menu de verdade fecha na hora
  if (!pop.classList.contains('hidden')) menuSaindo(pop, document.body);
  pop.classList.add('hidden'); pop.innerHTML = '';
}
function abrirPopGlobal(anchorEl) {
  fecharMenus(); fecharPopGlobal();
  const pop = $('#popGrupo'); if (!pop) return document.createElement('div');
  pop.innerHTML = ''; pop.onclick = (e) => e.stopPropagation();
  pop.classList.remove('hidden');
  const r = anchorEl.getBoundingClientRect();
  const largura = 240;
  pop.style.left = Math.min(window.innerWidth - largura - 10, Math.max(10, r.left)) + 'px';
  pop.style.top = Math.min(window.innerHeight - 60, r.bottom + 6) + 'px';
  // não coube embaixo: sobe. A altura só existe depois de pintar, por isso o setTimeout
  setTimeout(() => {
    if (pop.classList.contains('hidden')) return;
    const alt = pop.getBoundingClientRect().height;
    if (r.bottom + 6 + alt > window.innerHeight - 10) pop.style.top = Math.max(10, r.top - alt - 6) + 'px';
  }, 0);
  return pop;
}
/* item de uma linha do menu global (o elItem daqui desenha DENTRO de um painel) */
function popItem({ nome, ic, cor, on, perigo }, aoClicar) {
  const d = document.createElement('div');
  d.className = 'mi' + (on ? ' on' : '') + (perigo ? ' mi-perigo' : '');
  // mesma forma do elItem (redesenho 26/09): a coluna do ✓ vem primeiro, à esquerda
  d.innerHTML = '<div class="mi-ck"></div><div class="mi-ic"></div><div class="mi-txt"><div class="mi-n"></div></div>';
  if (cor) { const b = document.createElement('span'); b.className = 'pop-cor'; b.style.background = cor; $('.mi-ic', d).appendChild(b); }
  else if (ic) $('.mi-ic', d).innerHTML = ico(ic);
  if (on) $('.mi-ck', d).innerHTML = ico('check');
  $('.mi-n', d).textContent = nome;     // nome de grupo é texto do dono: nunca vira HTML
  d.addEventListener('click', () => { fecharPopGlobal(); aoClicar(); });
  return d;
}

/* Esc do menu/janelinha global, em CAPTURA: roda ANTES do Esc do documento.
   R8: o stopPropagation é obrigatório — sem ele, o mesmo Esc que fecha esta janelinha descia
   até o tratador de baixo e MANDAVA PARAR o que a IA estava fazendo no chat em foco.
   Com nada global aberto a função sai na primeira linha e nada do que já existia muda. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const pop = $('#popGrupo'), mod = $('#modalGrupo');
  if (!pop || !mod) return;
  const temPop = !pop.classList.contains('hidden');
  const temMod = !mod.classList.contains('hidden');
  if (!temPop && !temMod) return;
  // a lista de atalhos e o quadro branco ficam por cima de tudo: lá o Esc continua sendo deles
  const telaAt = $('#telaAtalhos');
  if (telaAt && !telaAt.classList.contains('hidden')) return;
  if (typeof qdPainelAberto === 'function' && qdPainelAberto()) return;
  e.preventDefault(); e.stopPropagation();
  if (temPop) fecharPopGlobal(); else fecharModalGlobal();
}, true);
/* clique fora fecha o menu global. Em captura, com a guarda do closest: sem ela o próprio
   clique que ABRE (ou o clique num item) fecharia o menu antes de ele fazer o que faz. */
document.addEventListener('click', (e) => {
  const pop = $('#popGrupo');
  if (!pop || pop.classList.contains('hidden')) return;
  if (e.target && e.target.closest && e.target.closest('#popGrupo')) return;
  fecharPopGlobal();
}, true);

/* ============ apagar conversa (leva 8.2) ============
   Vai para a LIXEIRA, nunca apaga de vez: dá para restaurar de lá se ele mudar de ideia.
   Só o "Apagar" entra no menu — o "Exportar" do fork de origem joga em ~/Downloads, contra a
   regra da casa, e aqui a conversa já sai pelo vault (⌘S). */
async function apagarConversa(s, d) {
  /* 25/09: conversa costurada (trocou de IA no meio) vai inteira: cada parte mora no
     armazenamento de uma IA, e apagar so a mais nova faria a parte velha reaparecer sozinha. */
  const partes = Array.isArray(s.partes) && s.partes.length ? s.partes : [s];
  if (!confirm('Mandar “' + s.title + '” para a Lixeira?'
    + (partes.length > 1 ? '\n\nVão juntas as ' + partes.length + ' partes desta conversa.' : '')
    + '\n\nDá para restaurar de lá se mudar de ideia.')) return;
  const apagadas = [];
  let falha = '';
  for (const p of partes) {
    let r = null;
    try { r = await window.api.apagarSessao({ id: p.id, file: p.file, engine: p.engine }); }
    catch (e) { r = { error: String(e && e.message || e) }; }
    // parte que ja nao existe no disco (apagada por fora) nao e falha: so segue para a proxima
    if (r && !r.error) apagadas.push(p);
    else if (!p.fantasma && !falha) falha = (r && r.error) || 'sem resposta';
  }
  if (!apagadas.length) { alert('Não consegui apagar: ' + (falha || 'sem resposta')); return; }
  if (falha) alert('Uma parte desta conversa não foi para a Lixeira: ' + falha);
  if (d) d.remove();
  for (const p of apagadas) await esquecerParteApagada(p);
  window.api.setConfig(cfg);
  /* só tirar a linha da tela (d.remove()) deixa a contagem do cabeçalho do grupo velha — e ela
     é dos dois motores. Redesenhar as duas listas antes do marcarAbertas() acerta os números. */
  repintarGrupos();
  marcarAbertas();
}

/* Tudo o que o app ainda lembra de UMA parte que acabou de ir para a Lixeira. Separado do
   apagarConversa porque a conversa costurada passa aqui uma vez por parte. */
async function esquecerParteApagada(s) {
  /* chat aberto que usava esta conversa: o motor dela morre e o painel volta a aceitar
     mensagem. Sem isto ele ficava preso tentando retomar um arquivo que não existe mais.
     É o mesmo bloco do conversaDaPastaNova (aqui não existe "destravarPainel"). */
  for (const Q of panes.values()) {
    if (Q.resumeId !== s.id && Q.sessaoId !== s.id) continue;
    // R2-008: Codex repete o mesmo id em varios arquivos (ver motorQueAbriu) — sem checar o
    // arquivo, apagar uma conversa antiga derrubava a irma que continua viva noutro .jsonl.
    if (Q.sessaoFile && s.file && Q.sessaoFile !== s.file) continue;
    try { await window.api.paneStop({ paneId: Q.id, engine: Q.engine }); } catch {}
    Q.busy = false; Q.queued = null; Q.filaMsgs = []; escondePerm(Q);
    pararTrabalho(Q); limparPassos(Q); limparContinuar(Q);
    Q.sessaoId = null; Q.sessaoFile = ''; Q.resumeId = null;
    Q.started = false; Q.forkPendente = false;
    esquecerCadeiaDoPainel(Q);   // 25/09: a próxima mensagem começa uma conversa nova, sem costura
    setDot(Q, 'off');
    note(Q, 'Esta conversa foi apagada. A próxima mensagem começa uma nova.', true);
  }
  /* 25/09: chat que trocou de IA e ainda nao mandou nada guarda esta conversa como a parte de
     antes (parteAnterior), com o numero de conversa ja zerado — o laco de cima nao o acha. Sem
     soltar aqui, a proxima mensagem gravava a costura para uma conversa que esta na Lixeira
     (parte fantasma na lista, e apagar depois tentava mandar ela de novo). Quem tem esta parte
     na cadeia (partesAnteriores) larga ela tambem. */
  const ehEsta = (p) => !!p && p.engine === s.engine && p.id === s.id && !(p.file && s.file && p.file !== s.file);
  for (const Q of panes.values()) {
    if (ehEsta(Q.parteAnterior)) Q.parteAnterior = null;
    if (Array.isArray(Q.partesAnteriores) && Q.partesAnteriores.some(ehEsta)) Q.partesAnteriores = Q.partesAnteriores.filter(p => !ehEsta(p));
  }
  /* R10: o savePanes() remonta cfg.abas DO ZERO a partir dos chats vivos — limpar antes dele
     seria trabalho jogado fora. Depois dele sobram as abas gravadas que ainda não voltaram
     (abasQueNaoVoltaram), preservadas às cegas: nelas o número da conversa apagada continuaria
     lá e reabrir o app tentaria retomar uma conversa morta. */
  savePanes();
  for (const ab of (cfg.abas || [])) {
    // R2-008: só limpa se o arquivo bater também (fallback sem arquivo salvo = registro antigo)
    for (const c of (ab.chats || [])) if (c && c.sessao === s.id && (!c.arquivo || c.arquivo === s.file)) { c.sessao = ''; c.arquivo = ''; }
    // e a costura pendente guardada da aba que ainda nao voltou (25/09)
    for (const c of (ab.chats || [])) if (c && ehEsta(c.parteAnterior)) delete c.parteAnterior;
  }
  // R2-008: filtra por id E arquivo — senão a conversa irmã (arquivo diferente, mesmo id) sumia da lista
  if (Array.isArray(histCache[s.engine])) histCache[s.engine] = histCache[s.engine].filter(x => !(x.id === s.id && (x.file || '') === (s.file || '')));
  if (Array.isArray(cfg.favoritos)) cfg.favoritos = cfg.favoritos.filter(k => k !== chaveFav(s));
  if (cfg.grupoSessao) delete cfg.grupoSessao[chaveFav(s)];
  // a costura com as outras partes sai junto (o main tira do ligacoes.json no apagar)
  esquecerLigacoesLocais(s);
}

/* menu "⋯" da linha da conversa */
function menuDaConversa(bt, s, d) {
  const pop = abrirPopGlobal(bt);
  // 25/09: na conversa costurada, basta UMA parte morar na VPS para o Apagar daqui não alcançar
  if (s.remoto || (Array.isArray(s.partes) && s.partes.some(p => p.remoto))) {
    // o .jsonl dela mora no disco da VPS: apagar daqui não alcança o arquivo de lá.
    // Redesenho 26/09: o item fica DESATIVADO (--label-4), com o porquê no balão do mouse
    const av = popItem({ nome: 'Apagar conversa', ic: 'x' }, () => {});
    av.classList.add('mi-off');
    av.setAttribute('aria-disabled', 'true');
    av.title = 'Conversa do servidor: apagar só pela VPS';
    pop.appendChild(av);
    return;
  }
  pop.appendChild(popItem({ nome: 'Apagar conversa', ic: 'x', perigo: true }, () => apagarConversa(s, d)));
}

/* ============ grupos de conversa (leva 8.4) ============
   Valem para o Claude e para o Codex juntos: o mesmo grupo pode ter conversa dos dois.
   R10: a chave TEM de ser cfg.gruposConversa — o savePanes() faz `delete cfg.grupos` a cada
   salvamento, então um grupo guardado em cfg.grupos sumiria sozinho no salvamento seguinte. */
const GRUPO_CORES = ['#6ea8fe', '#d97757', '#5aa469', '#d7ba7d', '#e05252', '#b083f0', '#f0839f', '#4fd1c5'];
const filtroGrupo = { claude: null, codex: null, acp: null, gemini: null, grok: null, todas: null };   // não é salvo: volta a "Todos" a cada abertura
// a cor entra em style: se o config foi editado na mão, só passa o que é cor de verdade
const corSegura = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || '')) ? String(c) : GRUPO_CORES[0]);

function listaGrupos() { return Array.isArray(cfg.gruposConversa) ? cfg.gruposConversa : []; }
function grupoPorId(id) { return listaGrupos().find(g => g.id === id); }
// 25/09: o grupo da conversa costurada e o da parte mais nova que tiver um (ver chavesDaConversa)
function grupoDaSessao(s) {
  const g = cfg.grupoSessao || {};
  for (const k of chavesDaConversa(s).reverse()) if (g[k]) return g[k];
  return null;
}
function moverParaGrupo(s, grupoId) {
  if (!cfg.grupoSessao) cfg.grupoSessao = {};
  for (const k of chavesDaConversa(s)) delete cfg.grupoSessao[k];
  if (grupoId) cfg.grupoSessao[chaveFav(s)] = grupoId;
  window.api.setConfig(cfg);
  /* os DOIS motores, não só o da conversa movida: o grupo é compartilhado, então a contagem no
     cabeçalho do outro motor ficaria velha até o próximo desenho da lista. */
  repintarGrupos();
}
function grupoRecolhido(id) { return Array.isArray(cfg.gruposRecolhidos) && cfg.gruposRecolhidos.includes(id); }
function alternarGrupoRecolhido(id) {
  if (!Array.isArray(cfg.gruposRecolhidos)) cfg.gruposRecolhidos = [];
  const i = cfg.gruposRecolhidos.indexOf(id);
  if (i >= 0) cfg.gruposRecolhidos.splice(i, 1); else cfg.gruposRecolhidos.push(id);
  window.api.setConfig(cfg);
}
// grupo é de TODOS os motores: mexeu em um, as listas se redesenham
function repintarGrupos() {
  pintarAbasGrupo(VISTA_CONVERSAS);
  pintarConversas();
}

/* busca e grupo não convivem: quem escolhe um grupo com o campo de busca cheio teria o filtro
   descartado pelo paintHist. Limpar o campo junto faz o clique valer, e a tela não mente. */
function limparBuscaLateral(engine) {
  if (!buscaAtual[engine]) return;
  buscaAtual[engine] = '';
  const inp = $('.side-busca[data-busca="' + engine + '"]');
  if (inp) inp.value = '';
}

/* faixa de grupos acima da lista. Sem nenhum grupo criado ela não aparece: barra vazia só
   roubaria altura da lista. A porta de entrada para criar o primeiro é a pastinha da linha. */
function pintarAbasGrupo(engine) {
  const box = $('.grp-abas[data-grupos="' + engine + '"]');
  if (!box) return;
  box.innerHTML = '';
  const grupos = listaGrupos();
  if (!grupos.length) { filtroGrupo[engine] = null; return; }
  const ativo = filtroGrupo[engine];
  const bTodos = document.createElement('button');
  bTodos.className = 'aba-grupo' + (!ativo ? ' on' : '');
  bTodos.textContent = 'Todos';
  bTodos.addEventListener('click', () => {
    filtroGrupo[engine] = null; pintarAbasGrupo(engine);
    pintarConversas();
  });
  box.appendChild(bTodos);
  for (const g of grupos) {
    const bt = document.createElement('button');
    bt.className = 'aba-grupo' + (ativo === g.id ? ' on' : '');
    bt.title = g.nome;
    /* NOME PRÓPRIO: no fork de origem esta classe é ".aba-txt", que AQUI já é da aba de
       cliente (tplAba). Com o nome de lá, o CSS de uma repintava a outra. */
    const cor = document.createElement('span'); cor.className = 'aba-cor'; cor.style.background = corSegura(g.cor);
    const txt = document.createElement('span'); txt.className = 'grp-aba-txt'; txt.textContent = g.nome;
    bt.appendChild(cor); bt.appendChild(txt);
    bt.addEventListener('click', () => {
      limparBuscaLateral(engine);   // senão o paintHist descartaria o filtro que ele acabou de escolher
      filtroGrupo[engine] = g.id; pintarAbasGrupo(engine);
      pintarConversas();
    });
    box.appendChild(bt);
  }
  const bAdd = document.createElement('button');
  bAdd.className = 'aba-grupo aba-add';
  bAdd.innerHTML = ico('plus');
  bAdd.title = 'Novo grupo';
  bAdd.addEventListener('click', () => abrirModalGrupo(null));
  box.appendChild(bAdd);
}

/* criar / renomear grupo: nome + cor */
function abrirModalGrupo(existente) {
  const cx = abrirModalGlobal();
  const editando = !!existente;
  // a explicacao fica no balao do titulo: na tela, so o rotulo (redesenho 25/09)
  cx.innerHTML = '<div class="mo-top"><span class="mo-tit" title="Vale pro Claude e pro Codex juntos — o mesmo grupo pode ter conversa dos dois."></span><button class="mo-x"></button></div>'
    + '<div class="mo-form"><input id="pnNome" maxlength="40" placeholder="Nome do grupo, ex: Pedro"></div>'
    + '<div class="mo-dica" style="margin-top:10px">Cor</div>'
    + '<div class="cor-linha"></div>'
    + '<div class="mo-rodape"><button class="mo-btn destaque" id="pnOk"></button>'
    + '<button class="mo-btn" id="pnCancela">Cancelar</button></div>';
  $('.mo-tit', cx).textContent = editando ? 'Renomear grupo' : 'Novo grupo';
  $('.mo-x', cx).innerHTML = ico('x');
  $('#pnOk', cx).textContent = editando ? 'Salvar' : 'Criar grupo';
  $('.mo-x', cx).onclick = fecharModalGlobal;
  $('#pnCancela', cx).onclick = fecharModalGlobal;
  let corEscolhida = corSegura((existente && existente.cor) || GRUPO_CORES[Math.floor(Math.random() * GRUPO_CORES.length)]);
  const pintaCor = () => $$('.cor-sw', cx).forEach(b => {
    const on = b.dataset.cor === corEscolhida;
    b.classList.toggle('on', on);
    b.innerHTML = on ? ico('check') : '';
  });
  const linha = $('.cor-linha', cx);
  for (const c of GRUPO_CORES) {
    const b = document.createElement('button');
    b.className = 'cor-sw'; b.dataset.cor = c; b.style.background = c;
    b.addEventListener('click', () => { corEscolhida = c; pintaCor(); });
    linha.appendChild(b);
  }
  pintaCor();
  const inp = $('#pnNome', cx);
  inp.value = existente ? existente.nome : '';
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const salvar = () => {
    const nome = inp.value.trim();
    if (!nome) { inp.focus(); return; }
    if (!Array.isArray(cfg.gruposConversa)) cfg.gruposConversa = [];
    if (editando) { existente.nome = nome; existente.cor = corEscolhida; }
    else cfg.gruposConversa.push({ id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), nome, cor: corEscolhida });
    window.api.setConfig(cfg);
    fecharModalGlobal();
    repintarGrupos();
  };
  $('#pnOk', cx).onclick = salvar;
  // R8: Enter e Esc deste campo são DELE. O Esc já foi parado no listener em captura lá em
  // cima, mas esta trava é a rede de segurança para o dia em que aquele sair do caminho.
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); salvar(); }
    if (e.key === 'Escape') { e.preventDefault(); fecharModalGlobal(); }
  });
}

function apagarGrupo(g) {
  if (!confirm('Apagar o grupo “' + g.nome + '”?\n\nAs conversas continuam onde estão — elas só saem do grupo.')) return;
  cfg.gruposConversa = listaGrupos().filter(x => x.id !== g.id);
  if (cfg.grupoSessao) for (const k of Object.keys(cfg.grupoSessao)) if (cfg.grupoSessao[k] === g.id) delete cfg.grupoSessao[k];
  if (Array.isArray(cfg.gruposRecolhidos)) cfg.gruposRecolhidos = cfg.gruposRecolhidos.filter(x => x !== g.id);
  for (const k of Object.keys(filtroGrupo)) if (filtroGrupo[k] === g.id) filtroGrupo[k] = null;
  window.api.setConfig(cfg);
  fecharPopGlobal();
  repintarGrupos();
}

/* menu da pastinha: para qual grupo esta conversa vai */
function abrirMenuGrupoDaSessao(anchorEl, s) {
  const pop = abrirPopGlobal(anchorEl);
  const atual = grupoDaSessao(s);
  pop.appendChild(popItem({ nome: 'Sem grupo', ic: 'x', on: !atual }, () => moverParaGrupo(s, null)));
  const grupos = listaGrupos();
  if (grupos.length) {
    pop.appendChild(elLinha());
    for (const g of grupos) pop.appendChild(popItem({ nome: g.nome, cor: corSegura(g.cor), on: atual === g.id }, () => moverParaGrupo(s, g.id)));
  }
  pop.appendChild(elLinha());
  pop.appendChild(popItem({ nome: 'Novo grupo…', ic: 'plus' }, () => abrirModalGrupo(null)));
}

/* cabeçalho de um grupo dentro da lista, com as conversas dele embaixo */
function linhaGrupo(g, sessoes) {
  const cab = document.createElement('div');
  cab.className = 'grp-cab' + (grupoRecolhido(g.id) ? ' recolhido' : '');
  cab.innerHTML = '<span class="chev"></span><span class="grp-cor"></span>'
    + '<span class="grp-nome"></span><span class="grp-conta"></span>'
    + '<button class="grp-gear" title="Renomear, trocar cor ou apagar"></button>';
  $('.chev', cab).innerHTML = ico('chevron-down');
  $('.grp-cor', cab).style.background = corSegura(g.cor);
  $('.grp-nome', cab).textContent = g.nome;
  $('.grp-conta', cab).textContent = String(sessoes.length);
  $('.grp-gear', cab).innerHTML = ico('pencil');
  const corpo = document.createElement('div');
  corpo.className = 'grp-corpo';
  corpo.classList.toggle('hidden', grupoRecolhido(g.id));
  if (sessoes.length) for (const s of sessoes) corpo.appendChild(linhaConversa(s, ''));
  else corpo.appendChild(Object.assign(document.createElement('div'),
    { className: 'grp-vazio', textContent: 'vazio — use a pastinha na linha da conversa' }));
  cab.addEventListener('click', (e) => {
    if (e.target.closest('.grp-gear')) return;
    alternarGrupoRecolhido(g.id);
    cab.classList.toggle('recolhido');
    corpo.classList.toggle('hidden');
  });
  $('.grp-gear', cab).addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = abrirPopGlobal(e.currentTarget);
    pop.appendChild(popItem({ nome: 'Renomear / trocar cor', ic: 'pencil' }, () => abrirModalGrupo(g)));
    pop.appendChild(popItem({ nome: 'Apagar grupo', ic: 'x', perigo: true }, () => apagarGrupo(g)));
  });
  const bloco = document.createDocumentFragment();
  bloco.appendChild(cab); bloco.appendChild(corpo);
  return bloco;
}

function linhaConversa(s, termo, trecho) {
  const d = document.createElement('div');
  d.className = 'hist-item' + (trecho ? ' com-trecho' : '');
  d.dataset.sid = s.id;
  d.dataset.sfile = s.file || '';
  d.innerHTML = '<span class="hi-w"></span><span class="hi-t"></span>'
    + (trecho ? '<span class="hi-trecho"></span>' : '')
    + '<button class="hi-fav" title="Deixar no topo"></button>'
    + '<button class="hi-edit" title="Renomear"></button>';
  marcarTermo($('.hi-t', d), s.title, trecho ? '' : termo);
  $('.hi-w', d).textContent = quandoCurto(s.when);
  /* 25/09: os logos das IAs que trabalharam nesta conversa, na ordem em que entraram e sem
     repetir. Conversa de uma IA so mostra um logo. A cor de cada IA fica SO no logo. */
  const logos = logosDaConversa(s);
  if (logos) d.insertBefore(logos, $('.hi-t', d));
  if (trecho) marcarTermo($('.hi-trecho', d), trechoPerto(trecho, termo), termo);
  $('.hi-edit', d).innerHTML = ico('pencil');
  const favorita = ehFavorita(s);
  const bf = $('.hi-fav', d);
  bf.innerHTML = ico('star');
  bf.classList.toggle('on', favorita);
  bf.title = favorita ? 'Tirar do topo' : 'Deixar no topo';
  d.classList.toggle('favorita', favorita);
  bf.addEventListener('click', async (e) => {
    e.stopPropagation();
    trocarFavorita(s);
    pintarConversas();   // 25/09: uma lista so para todas as IAs
  });
  /* ---- botões novos da leva 8, pendurados por DOM (a linha do innerHTML acima não foi
     tocada): a pastinha manda a conversa para um grupo, o "⋯" abre o menu com o Apagar. ---- */
  const gAtual = grupoDaSessao(s);
  const bg = document.createElement('button');
  bg.className = 'hi-grupo' + (gAtual ? ' on' : '');
  bg.innerHTML = ico('folder');
  const gg = gAtual ? grupoPorId(gAtual) : null;
  if (gg) bg.style.color = corSegura(gg.cor);
  bg.title = gg ? 'No grupo “' + gg.nome + '” — clique para mover' : 'Mover pra grupo';
  bg.addEventListener('click', (e) => { e.stopPropagation(); abrirMenuGrupoDaSessao(bg, s); });
  d.appendChild(bg);
  const bm = document.createElement('button');
  bm.className = 'hi-mais';
  bm.title = 'Mais ações';
  bm.innerHTML = ico('ellipsis');
  bm.addEventListener('click', (e) => { e.stopPropagation(); menuDaConversa(bm, s, d); });
  d.appendChild(bm);
  d.title = s.title + '\n' + s.cwd;
  d.addEventListener('click', (e) => { if (!e.target.closest('.hi-edit')) openSession(s, d); });
  $('.hi-edit', d).addEventListener('click', (e) => {
    e.stopPropagation();
    if ($('.pn-input', d)) return;
    const alvo = $('.hi-t', d), lapis = $('.hi-edit', d);
    const inp = document.createElement('input');
    inp.className = 'pn-input';
    inp.value = s.title;
    alvo.style.display = 'none'; lapis.style.display = 'none';
    d.insertBefore(inp, alvo);
    inp.focus(); inp.select();
    let pronto = false;
    const fim = async (salvar) => {
      if (pronto) return; pronto = true;
      const novo = inp.value.trim();
      inp.remove(); alvo.style.display = ''; lapis.style.display = '';
      if (!salvar || !novo || novo === s.title) return;
      await window.api.renomear({ engine: s.engine, id: s.id, nome: novo, origem: 'manual' });
      s.title = novo;
      alvo.textContent = novo;
      d.title = novo + '\n' + s.cwd;
      /* 25/09: antes o cache do motor era zerado para a coluna dele reler. Com a lista unica,
         zerar sumiria com TODAS as conversas daquela IA ate a releitura: o nome novo entra
         direto na linha guardada (e no titulo da cadeia, que e a parte mais nova). */
      lembrarNomeDaParte(s, novo);
      for (const P of panes.values()) if (P.resumeId === s.id || P.sessaoId === s.id) { P.titulo = novo; P.nomeManual = true; pintarNome(P); }
    };
    inp.onclick = (ev) => ev.stopPropagation();
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); fim(true); }
      if (ev.key === 'Escape') fim(false);
    });
    inp.addEventListener('blur', () => fim(true));
  });
  pintarAberta(d);
  return d;
}

/* Linha de RESULTADO de busca. E a mesma linha de sempre, com uma etiqueta a mais: agora a
   busca mistura os quatro motores e todas as pastas, entao sem dizer "Codex · Pedro" ele nao
   sabe de onde aquela conversa veio. So rotulo, sem frase.
   A etiqueta entra DEPOIS do titulo, e a marca com-onde poe cada um na sua linha: ao lado do
   titulo ela ficava com o nome inteiro do cliente e o titulo aparecia com uma letra so. */
function linhaDaBusca(s, termo, trecho) {
  const d = linhaConversa(s, termo, trecho);
  d.classList.add('com-onde');
  const et = document.createElement('span');
  et.className = 'hi-onde';
  const cliente = nomeProjeto(clienteDe(s.cwd));
  et.textContent = nomeDoMotor(s.engine) + (cliente ? ' · ' + cliente : '');
  const tit = $('.hi-t', d);
  d.insertBefore(et, tit.nextSibling);
  return d;
}

/* Cada desenho da lista ganha um numero. Como a busca dentro das conversas demora segundos,
   dava tempo de outro desenho comecar (mais uma letra digitada, troca de aba, fim de resposta):
   quando o antigo acordava, despejava os resultados VELHOS por cima do desenho novo e a lista
   aparecia duplicada e misturada. Agora o desenho velho percebe que ficou para tras e desiste. */
const pintaVez = { claude: 0, codex: 0, acp: 0, gemini: 0, grok: 0, todas: 0 };

// tira acento pra comparar (diferente de normalizarFala: essa não tira pontuação nem número)
function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

async function paintHist(engine, listaCrua) {
  const minhaVez = ++pintaVez[engine];
  const box = caixaHist(engine);   // [EDITA leva 12.4] sem isto o ACP APAGAVA a lista do Codex
  const termo = (buscaAtual[engine] || '').toLowerCase().trim();
  pintarBotaoFiltro(engine);
  /* buscar e filtrar por grupo ao mesmo tempo faria a faixa MENTIR: o ramo da busca lá embaixo
     procura na lista inteira e não olha o filtroGrupo. Ao digitar, a faixa volta sozinha para
     "Todos" — visível na tela, em vez de o filtro ser jogado fora em silêncio. */
  if (termo && filtroGrupo[engine]) filtroGrupo[engine] = null;
  pintarAbasGrupo(engine);   // leva 8: a faixa de grupos acompanha cada desenho da lista
  /* DIGITOU = procura em TUDO: os quatro motores e o Mac inteiro, sem filtro de pasta.
     Antes a busca so via a lista deste motor e so a pasta da aba aberta, entao achar "aquela
     conversa do checkout" exigia lembrar em qual motor foi E em qual cliente ele estava, e
     repetir a busca ate quatro vezes. Filtro de pasta e faixa de grupo continuam mandando na
     lista PARADA; ao digitar, eles saem da frente (o botao de pasta mostra "Mac inteiro"
     enquanto a busca dura, e cada resultado diz de qual motor e de qual cliente veio). */
  if (termo) lerHistoricoDeTodosOsMotores(engine);   // motor cuja coluna nunca abriu tambem entra
  const list = termo ? todasAsConversas() : filtrarPorPasta(engine, listaCrua);
  box.innerHTML = '';
  if (!list.length) {
    /* Sem busca, lista vazia com conversas existindo quer dizer que o filtro de pasta cortou.
       Buscando, a lista ja e o Mac inteiro: vazia ali e vazia mesmo. */
    box.innerHTML = '<div class="hist-load">'
      + (!termo && listaCrua.length ? 'Nenhuma conversa nesta pasta.' : 'Nenhuma conversa ainda.') + '</div>';
    return;
  }

  if (!termo) {
    /* leva 8: uma aba de grupo escolhida na faixa de cima — a lista mostra só o que está nele */
    const alvoGrupo = filtroGrupo[engine];
    if (alvoGrupo) {
      const g = grupoPorId(alvoGrupo);
      // grupo cruza pasta DE PROPOSITO (o mesmo grupo pode ter conversa de clientes diferentes):
      // filtra da lista CRUA, sem o corte de filtrarPorPasta, senao a conversa do grupo que mora
      // noutra pasta some da tela sem aviso quando a aba ativa muda
      const doGrupo = listaCrua.filter(s => grupoDaSessao(s) === alvoGrupo);
      if (!doGrupo.length) {
        box.appendChild(Object.assign(document.createElement('div'),
          { className: 'hist-load', textContent: 'Nada em “' + (g ? g.nome : '') + '” ainda.' }));
      } else for (const s of doGrupo) box.appendChild(linhaConversa(s, ''));
      return;
    }
    const favs = list.filter(ehFavorita);
    if (favs.length) {
      box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: 'Favoritas' }));
      for (const s of favs) box.appendChild(linhaConversa(s, ''));
    }
    /* [EDITA aprovado pelo plano, 1 palavra] `const` virou `let`: o laço dos grupos abaixo
       reatribui esta lista, e com `const` dava "Assignment to constant variable" — a coluna
       lateral ficava em branco. */
    let restantes = list.filter(s => !ehFavorita(s));
    /* os grupos aparecem sempre, mesmo vazios: é neles que ele enxerga onde pôr a conversa */
    for (const g of listaGrupos()) {
      // conta e mostra cruzando pasta, igual ao alvoGrupo acima: sem isso o numero do cabecalho
      // do grupo mudava sozinho conforme a aba ativa, mesmo grupo sem ele ter mexido em nada
      const doGrupo = listaCrua.filter(s => grupoDaSessao(s) === g.id);
      restantes = restantes.filter(s => grupoDaSessao(s) !== g.id);
      box.appendChild(linhaGrupo(g, doGrupo));
    }
    let grupoAtual = '';
    for (const s of restantes) {
      const g = grupoDoTempo(s.when);
      if (g !== grupoAtual) {
        grupoAtual = g;
        box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: g }));
      }
      box.appendChild(linhaConversa(s, ''));
    }
    return;
  }

  // R2-011: sem tirar acento, "codigo" não achava "código" (e vice-versa)
  const termoSemAcento = semAcento(termo);
  /* 25/09: a busca olha cada PARTE (o texto de cada IA mora num arquivo), mas o que aparece e
     o item da conversa inteira: achado na parte velha leva a cadeia toda, e a mesma conversa
     achada em duas partes aparece uma vez so. */
  const daCadeia = mapaDasCadeias(listaCrua);
  const jaMostrada = new Set();
  const mostrar = (s) => {
    const c = daCadeia.get(s) || s;
    const k = chaveFav(c);
    if (jaMostrada.has(k)) return null;
    jaMostrada.add(k);
    return c;
  };
  const porNome = list.filter(s => semAcento(String(s.title || '').toLowerCase()).includes(termoSemAcento));
  const resto = list.filter(s => !porNome.includes(s));
  const porNomeUnicas = porNome.map(mostrar).filter(Boolean);
  if (porNomeUnicas.length) {
    box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: 'no nome' }));
    for (const s of porNomeUnicas) box.appendChild(linhaDaBusca(s, termo));
  }
  const aviso = document.createElement('div');
  aviso.className = 'hist-load';
  aviso.textContent = 'procurando dentro das conversas…';
  box.appendChild(aviso);

  let r;
  try { r = await window.api.buscarConversas({ engine, termo, itens: resto.map(s => ({ id: s.id, file: s.file })) }); }
  catch (e) {
    if (minhaVez === pintaVez[engine]) aviso.textContent = 'Não consegui buscar nas conversas: ' + (e.message || e);
    return;
  }
  if (minhaVez !== pintaVez[engine]) return;   // ja tem um desenho mais novo: este morreu
  // o main passou a devolver { achados, parcial }; a versao antiga devolvia so a lista
  const achados = Array.isArray(r) ? r : ((r && r.achados) || []);
  const parcial = (r && !Array.isArray(r) && r.parcial) || null;
  aviso.remove();
  if (!achados.length) {
    if (!porNome.length) box.replaceChildren(Object.assign(document.createElement('div'),
      { className: 'hist-load', textContent: 'Nada com “' + termo + '”.' }));
    // o aviso de "olhei so as mais recentes" vale mesmo quando ja houve acerto pelo nome
    if (parcial) box.appendChild(Object.assign(document.createElement('div'), {
      className: 'hist-load',
      textContent: 'Olhei as ' + parcial.vistos + ' conversas mais recentes de ' + parcial.total + '. Escreva mais palavras para achar nas antigas.',
    }));
    return;
  }
  box.appendChild(Object.assign(document.createElement('div'), { className: 'hist-cab', textContent: 'dentro da conversa' }));
  for (const a of achados) {
    const s = resto.find(x => x.id === a.id);
    const c = s && mostrar(s);
    if (c) box.appendChild(linhaDaBusca(c, termo, a.trecho));
  }
  // nunca cortar em silencio: se a busca parou no meio, ele precisa saber
  if (parcial) {
    box.appendChild(Object.assign(document.createElement('div'), {
      className: 'hist-load',
      textContent: 'Olhei as ' + parcial.vistos + ' conversas mais recentes de ' + parcial.total + '. Pode haver mais nas antigas.',
    }));
  }
}

async function openSession(s, el) {
  const remoto = !!s.remoto || NA_VPS(s.cwd);
  /* 25/09: a conversa pode ser uma CADEIA (trocou de IA no meio). O item da lista ja traz as
     partes; quem chega com um numero solto (reabrir o fechado, o celular voltando para a
     ultima conversa) acha a cadeia pelas ligacoes. O painel fica na parte MAIS NOVA. */
  const partes = Array.isArray(s.partes) && s.partes.length ? s.partes : partesDaCadeia(s);
  // ja esta aberta em algum painel? so leva voce ate ela (sem piscar: trocar de chat e instantaneo)
  // R2-007: checa também o arquivo (igual motorQueAbriu) — Codex repete o mesmo id em várias
  // .jsonl; sem isso, abrir uma versão ANTIGA só focava a versão atual já aberta, sem trocar.
  const aberta = [...panes.values()].find(q => q.engine === s.engine && NA_VPS(q.cwd) === remoto
    && (q.resumeId === s.id || q.sessaoId === s.id)
    && !(q.sessaoFile && s.file && q.sessaoFile !== s.file));
  // chat que acabou de trocar de IA (ainda sem mandar nada) continua sendo o dono desta conversa
  const trocando = aberta || [...panes.values()].find(q => q.parteAnterior && q.parteAnterior.engine === s.engine
    && q.parteAnterior.id === s.id && !(q.parteAnterior.file && s.file && q.parteAnterior.file !== s.file));
  if (trocando) {
    document.querySelectorAll('.hist-item').forEach(x => x.classList.remove('on'));
    if (el) el.classList.add('on');
    setFocus(trocando);
    $('.p-input', trocando.el).focus();
    return trocando;
  }
  // cada conversa da lista abre no seu proprio painel, sem atropelar o que ja esta rolando
  // a conversa abre na aba do cliente dela, mesmo que tenha nascido numa subpasta
  const A = abaDoCaminho(s.cwd, true);
  let P = newPane({ engine: s.engine, aba: A, cwd: s.cwd, titulo: s.title });
  // marca "nasceu agora": distingue do ramo "aberta" acima, que devolve um painel JA em uso (R3-008)
  if (P) P._painelNovoDeAbertura = true;
  document.body.classList.remove('gaveta');
  document.querySelectorAll('.hist-item').forEach(x => x.classList.remove('on'));
  if (el) el.classList.add('on');

  // O painel acabou de nascer e não possui motor. Identificar a conversa antes
  // do primeiro await também impede que um clique duplo crie dois painéis iguais.
  invalidarConversa(P);
  const revisao = P.revisaoConversa;
  P.carregandoHistorico = true;
  escondePerm(P);
  P.engine = s.engine; P.cwd = s.cwd; P.resumeId = s.id; P.sessaoId = null; P.started = false; P.busy = false; P.model = '';
  if (s.engine === 'acp' && s.comando) P.model = s.comando;
  P.forkPendente = false;   // leva 8.3: abrir outra conversa aqui cancela a intencao de ramificar
  P.worktree = '';          // leva 10.5: a conversa escolhida nasceu na pasta principal, nao na branch isolada
  P.serviceTier = ''; P.experimentalContext = false; P.collaborationMode = 'default';
  P.effectiveSettings = null; P.settingsPending = false;
  P.sessaoFile = s.file || '';   // guardado para a conversa voltar cheia quando reabrir o app
  P.titulo = s.title || ''; P.nomeCurto = false; P.nomeManual = false; P.hist = []; limparPlano(P); limparSugestoes(P);
  // as partes de antes da troca de IA: o proximo "trocar de IA" continua a MESMA cadeia
  P.parteAnterior = null; P.partesAnteriores = partes.slice(0, -1).map(refDaParte);
  P.blocks.clear(); P.tools.clear(); P.chat.innerHTML = ''; P.rolagem = null;   // solta a mensagem-ancora da memoria
  fillModels(P); paintEngine(P); setDot(P, 'off');
  pintarPasta(P, nomePasta(P.cwd));
  mostrarPastaNoPainel(P); atualizarGit(P);   // leva 10: tira o "⎇ nome" e repõe o chip do git
  pintarModo(P); pintarNome(P);
  setFocus(P); savePanes();
  marcarAbertas();   // repinta a borda de "aberta" na lista, senao so aparece depois do 1o redesenho

  note(P, 'Conversa: ' + s.title);
  /* Conversa que rodou na VPS mora no disco DELA: o arquivo daqui não existe, e sem este
     desvio clicar nela abria um chat vazio. O caminho local segue exatamente como era. */
  try {
    if (partes.length > 1) {
      /* cadeia: o historico de cada parte, da mais velha para a mais nova, no MESMO painel,
         com a faixa "daqui em diante quem responde é o…" entre uma IA e outra. O P.hist
         recebe tudo: se ele trocar de IA de novo, a proxima leva o contexto inteiro. */
      const lidas = await lerPartes(partes);
      if (!painelAindaAtual(P, revisao)) return;
      if (!desenharPartes(P, lidas) && lidas.some(x => x.erro)) throw lidas.find(x => x.erro).erro;
      $$('.tool-st.run', P.el).forEach(x => { x.className = 'tool-st ok'; x.innerHTML = ico('check'); });
      scroll(P, true);
      if (focusPane === P) $('.p-input', P.el).focus();
      return P;
    }
    const msgs = remoto
      ? await window.api.sessionHistoryRemoto({ id: s.id })
      : await window.api.sessionHistory({ engine: s.engine, file: s.file, id: s.id, cwd: s.cwd });
    if (!painelAindaAtual(P, revisao)) return;
    if (!Array.isArray(msgs)) throw new Error(msgs && (msgs.error || msgs.erro) || 'Histórico indisponível.');
    for (const m of msgs) renderizarHistorico(P, m);
    $$('.tool-st.run', P.el).forEach(x => { x.className = 'tool-st ok'; x.innerHTML = ico('check'); });
    scroll(P, true);
    if (focusPane === P) $('.p-input', P.el).focus();
  } catch (e) {
    if (painelAindaAtual(P, revisao)) note(P, 'Não consegui abrir o histórico: ' + (e.message || e), true);
  } finally {
    if (painelAindaAtual(P, revisao)) P.carregandoHistorico = false;
  }
  /* de quem e o nome: sem isto, conversa aberta da lista nunca mais era renomeada, e a "Criacao
     Dupla" do exemplo dele ficava com esse nome mesmo com ele continuando a conversa por dias */
  lembrarDonoDoNome(P, s.id, s.title || '', revisao);   // sem await: quem abriu nao espera por isso
  return P;   // R2-033: devolve o painel pra quem chamou saber onde a conversa abriu (ex.: reabrir fechado)
}

async function novaConversa(engine) {
  engine = motorVisivel(engine);
  const motivo = motorIndisponivelNaPasta(engine, abaAtiva?.cwd || focusPane?.cwd);
  if (motivo) { if (focusPane) avisoTemp(focusPane, motivo, true); return; }
  const P = novoChatNaAba(engine);
  if (!P) return;
  document.body.classList.remove('gaveta');   // no celular, sai da lista e mostra a conversa nova
  await window.api.paneStop({ paneId: P.id, engine: P.engine });
  escondePerm(P);
  // sessaoId TEM de zerar junto: se ficar o da conversa anterior, uma queda de conexao faria
  // o "religar" voltar para a conversa velha em vez desta nova
  P.engine = engine; P.resumeId = null; P.sessaoId = null; P.started = false; P.titulo = ''; P.nomeCurto = false; P.hist = []; limparPlano(P); limparSugestoes(P);
  P.forkPendente = false;   // leva 8.3: conversa nova nunca e ramo de outra
  esquecerCadeiaDoPainel(P);   // 25/09: nem continuação costurada de outra
  // conversa nova sempre volta ao modelo e ao esforço de PADRAO_NOVO, mesmo que o chat
  // anterior estivesse em outro
  P.model = modeloNovo(engine); P.effort = esforcoNovo(engine); P.ultraAvisado = false;
  P.serviceTier = ''; P.experimentalContext = false; P.collaborationMode = 'default';
  P.effectiveSettings = null; P.settingsPending = false;
  P.blocks.clear(); P.tools.clear(); voltarVazio(P); pintarNome(P);
  fillModels(P); paintEngine(P); setDot(P, 'off'); setFocus(P);
  avisarInstalacaoMotor(P);
  marcarAbertas();          // a conversa que estava aqui deixou de estar aberta
  $('.p-input', P.el).focus();
}

$$('.side-busca').forEach(inp => {
  let timer = 0;
  inp.addEventListener('input', () => {
    const eng = inp.dataset.busca;
    buscaAtual[eng] = inp.value;
    clearTimeout(timer);
    timer = setTimeout(pintarConversas, 260);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); inp.value = ''; buscaAtual[inp.dataset.busca] = '';
      pintarConversas(); }
  });
});

$$('.side-filtro').forEach(bt => bt.addEventListener('click', (e) => {
  e.stopPropagation();
  const eng = bt.dataset.filtro;
  const cx = $('.side-pastas[data-pastas="' + eng + '"]');
  const abrindo = cx.classList.contains('hidden');
  $$('.side-pastas').forEach(x => x.classList.add('hidden'));
  if (abrindo) { pintarPastas(eng); cx.classList.remove('hidden'); }
}));
document.addEventListener('click', (e) => {
  if (e.target.closest('.side-pastas') || e.target.closest('.side-filtro')) return;
  $$('.side-pastas').forEach(x => x.classList.add('hidden'));
});

// 25/09: um ↻ só, que relê as conversas de todas as IAs (e a costura entre elas) e, como o ↻ do
// cartão de conta que saiu, a conta de cada IA (no máximo uma vez por minuto, por causa do 429)
document.querySelectorAll('[data-reload]').forEach(b =>
  b.addEventListener('click', () => { recarregarConversas(true); pintarUsoLateral(true); }));
/* "Novo chat nesta aba" da lista unica: nasce na IA do chat em foco (ou na ultima usada),
   o mesmo motor que o "+ chat" da barra de abas escolheria */
document.querySelectorAll('[data-new]').forEach(b =>
  b.addEventListener('click', () => novaConversa((focusPane && focusPane.engine) || cfg.lastEngine)));
/* leva 10.2: "Atualizar agora" da torre. O `true` fura o cache de 30s da lista de fora — é o
   único jeito de ver na hora um Claude que ele acabou de abrir no Terminal. */
{
  const btTorre = document.getElementById('btnTorreAtualizar');
  if (btTorre) { btTorre.innerHTML = ico('refresh-cw'); btTorre.addEventListener('click', () => pintarTorre(true)); }
  // leva 11: o mesmo botão para as rotinas — `true` fura o cache de 20s da lista
  const btRotinas = document.getElementById('btnRotinasAtualizar');
  if (btRotinas) { btRotinas.innerHTML = ico('refresh-cw'); btRotinas.addEventListener('click', () => pintarRotinas(true)); }
}

/* ============ arrastar: chats dentro da aba, e abas entre si ============ */

// pega um chat pelo cabecalho e leva para outra posicao (ou para outra aba)
function comecarArrastePane(P, e0) {
  const x0 = e0.clientX, y0 = e0.clientY;
  let ativo = false, fantasma = null, marca = null, alvo = null;

  const move = (ev) => {
    if (!ativo) {
      if (Math.abs(ev.clientX - x0) < 6 && Math.abs(ev.clientY - y0) < 6) return;
      ativo = true;
      document.body.classList.add('arrastando-aba');
      P.el.classList.add('saindo');
      fantasma = document.createElement('div');
      fantasma.className = 'aba-fantasma';
      fantasma.innerHTML = '<span class="aba-ic">' + svgMotor(P.engine) + '</span><span class="ft-n"></span>';
      $('.ft-n', fantasma).textContent = P.titulo || 'Conversa nova';
      document.body.appendChild(fantasma);
      marca = document.createElement('div');
      marca.className = 'aba-marca'; marca.style.display = 'none';
      document.body.appendChild(marca);
    }
    fantasma.style.left = (ev.clientX + 13) + 'px';
    fantasma.style.top = (ev.clientY - 15) + 'px';
    alvo = alvoDoPane(ev, P);
    pintarAlvoPane(alvo, marca);
  };

  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('arrastando-aba');
    if (fantasma) fantasma.remove();
    if (marca) marca.remove();
    P.el.classList.remove('saindo');
    if (ativo && alvo) soltarPane(P, alvo);
  };

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

// onde o chat vai cair: entre dois chats da tela, ou em cima de outra aba
function alvoDoPane(ev, P) {
  const sob = document.elementFromPoint(ev.clientX, ev.clientY);
  if (!sob) return null;

  // largou em cima de uma aba de projeto: o chat muda de projeto
  const abaEl = sob.closest('#abasTopo .aba');
  if (abaEl) {
    const A = abas.get(abaEl.dataset.aid);
    if (!A) return null;
    const r = abaEl.getBoundingClientRect();
    return { tipo: 'outraAba', A, x: r.left, y: r.top, h: r.height };
  }

  const A = abaAtiva;
  if (!A || !sob.closest('.espaco')) return null;
  const paneEl = sob.closest('.pane');
  const Q = paneEl && panes.get(paneEl.dataset.id);
  if (!Q || Q === P) return null;
  const r = paneEl.getBoundingClientRect();
  const meio = ev.clientX > r.left + r.width * .22 && ev.clientX < r.right - r.width * .22;
  if (meio) {
    const antes = ev.clientY < r.top + r.height / 2;
    return { tipo: 'pilha', A, Q, antes, x: r.left, y: antes ? r.top : r.bottom - 3, h: 3, w: r.width };
  }
  const antes = ev.clientX < r.left + r.width / 2;
  const col = paneEl.closest('.coluna').getBoundingClientRect();
  return { tipo: 'coluna', A, Q, antes, x: antes ? col.left : col.right, y: col.top, h: col.height, w: 3 };
}

function pintarAlvoPane(alvo, marca) {
  if (!marca) return;
  if (!alvo) { marca.style.display = 'none'; return; }
  marca.style.display = '';
  marca.style.left = (alvo.x - 1) + 'px';
  marca.style.top = alvo.y + 'px';
  marca.style.height = alvo.h + 'px';
  marca.style.width = (alvo.w || 3) + 'px';
}

function soltarPane(P, alvo) {
  const A0 = abaDe(P);
  if (alvo.tipo === 'outraAba') {
    if (alvo.A === A0) return;
    moverPane(P, alvo.A, null);
    return;
  }
  if (alvo.tipo === 'pilha' || alvo.tipo === 'coluna') {
    organizarPainel(P, alvo.Q, alvo.tipo === 'pilha', alvo.antes); return;
  }
  // alvoDoPane so devolve 'outraAba', 'pilha' ou 'coluna': nao ha 4o tipo com .indice, era codigo morto
}

// arrastar a propria aba de projeto para trocar a ordem no topo
function comecarArrasteAba(A, e0) {
  const x0 = e0.clientX;
  let ativo = false, fantasma = null, marca = null, indice = null;

  const move = (ev) => {
    if (!ativo) {
      if (Math.abs(ev.clientX - x0) < 5) return;
      ativo = true;
      document.body.classList.add('arrastando-aba');
      A.el.classList.add('saindo');
      fantasma = document.createElement('div');
      fantasma.className = 'aba-fantasma';
      fantasma.innerHTML = '<span class="aba-ic">' + ico('folder') + '</span><span class="ft-n"></span>';
      $('.ft-n', fantasma).textContent = nomeProjeto(A.cwd);
      document.body.appendChild(fantasma);
      marca = document.createElement('div');
      marca.className = 'aba-marca'; marca.style.display = 'none';
      document.body.appendChild(marca);
    }
    fantasma.style.left = (ev.clientX + 13) + 'px';
    fantasma.style.top = (ev.clientY - 15) + 'px';

    const lista = $('#abasLista');
    const els = [...lista.children];
    const r0 = lista.getBoundingClientRect();
    indice = els.length; let x = 0;
    for (let k = 0; k < els.length; k++) {
      const r = els[k].getBoundingClientRect();
      if (ev.clientX < r.left + r.width / 2) { indice = k; x = r.left; break; }
      x = r.right;
    }
    if (indice === els.length) x = els.length ? els[els.length - 1].getBoundingClientRect().right : r0.left;
    marca.style.display = '';
    marca.style.left = (x - 1) + 'px';
    marca.style.top = r0.top + 'px';
    marca.style.height = r0.height + 'px';
  };

  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('arrastando-aba');
    if (fantasma) fantasma.remove();
    if (marca) marca.remove();
    A.el.classList.remove('saindo');
    if (!ativo || indice == null) return;
    const lista = $('#abasLista');
    const els = [...lista.children];
    const cur = els.indexOf(A.el);
    const idx = indice;
    // a aba arrastada NUNCA sai do HTML (so fica com opacidade .4 via .saindo), entao
    // 'els' e 'indice' ja contam com ela: nao compensar de novo, senao o alvo fica 1 casa atras
    if (idx === cur) return;
    lista.insertBefore(A.el, lista.children[idx] || null);
    // a ordem do Map segue a ordem da tela, para o cmd+1..9 bater
    const novaOrdem = [...lista.children].map(el => abas.get(el.dataset.aid)).filter(Boolean);
    abas.clear();
    for (const B of novaOrdem) abas.set(B.id, B);
    savePanes();
  };

  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/* ============ tela do meio: nova conversa ============ */
const naEstado = { motor: 'claude', pasta: '', onde: 'mac' };

function telaNovaAba(obrigatoria) {
  const el = $('#novaAba');
  naEstado.motor = motorVisivel(cfg.lastEngine);
  /* ja nasce na pasta padrao dos Ajustes. Antes nascia vazia, e a UNICA forma de escolher era
     abrir a janela de pastas do macOS e navegar ate la, varias vezes por dia. */
  naEstado.pasta = (cfg.defCwd && cfg.defCwd !== HOME) ? cfg.defCwd : '';
  naEstado.onde = 'mac';
  naPintar();
  naPintarAtalhosMac();
  el.dataset.travada = obrigatoria ? '1' : '';
  // sem nenhuma aba aberta nao ha para onde voltar: o Cancelar sairia mudo, entao nem aparece
  const cancela = $('#naCancela'); if (cancela) cancela.classList.toggle('hidden', !!obrigatoria);
  el.classList.remove('hidden');
  /* o Enter continua comecando (o foco fica no Começar), mas sem o anel: foco posto por codigo
     nao e navegacao de teclado, e no desenho a capsula azul abre limpa. O anel volta no Tab. */
  setTimeout(() => $('#naOk').focus({ focusVisible: false }), 40);
}

function fecharNovaAba() {
  const el = $('#novaAba');
  if (el.dataset.travada === '1') return;
  el.classList.add('hidden');
}

function naPintar() {
  const naVps = naEstado.onde === 'vps';
  const motivo = motorIndisponivelNaPasta(naEstado.motor, naVps ? 'vps:/' : '');
  $('#naOk').disabled = !!motivo;
  $$('.na-motor').forEach(b => {
    b.classList.toggle('on', b.dataset.motor === naEstado.motor);
    // apagado = não dá para usar daqui. Continua clicável de propósito: clicando, a dica
    // embaixo diz o motivo e o "Começar" fica travado — melhor que um botão morto e mudo.
    const naoDa = motorIndisponivelNaPasta(b.dataset.motor, naVps ? 'vps:/' : '');
    b.classList.toggle('apagado', !!naoDa);
    b.title = naoDa || '';
  });
  $$('.na-onde').forEach(b => b.classList.toggle('on', b.dataset.onde === naEstado.onde));
  $('#naPasta').classList.toggle('hidden', naVps);
  $('#naAtalhosMac').classList.toggle('hidden', naVps);
  $('#naRemoto').classList.toggle('hidden', !naVps);
  $('#naEscolhida').classList.toggle('hidden', naVps || !naEstado.pasta);
  $('#naPastaNome').textContent = naEstado.pasta ? shortPath(naEstado.pasta) : '';
  // na tela so' fica o motivo quando algo impede (motor que nao roda ali). A explicacao de
  // onde ele trabalha vira dica de passar o mouse no "Começar": frase explicativa na tela ele
  // manda tirar (regra dele de 18/09: so rotulo e numero).
  $('#naDica').textContent = motivo || '';
  $('#naOk').title = naVps
    ? 'Ele roda dentro da VPS, na conta e no disco de lá.'
    : (naEstado.pasta
        ? 'Ele começa dentro dessa pasta, mas continua enxergando o Mac inteiro.'
        : 'Sem pasta escolhida, ele abre no Mac inteiro.');
  $('#naDois').classList.toggle('hidden', true);   // ele pediu para tirar o "dois lado a lado" (11/09)
  // a cor do assistente escolhido vale so para o logo dele (--motor); o "Começar" e o anel do
  // cartão escolhido ficam no azul do sistema, igual em qualquer assistente (redesenho 25/09)
  $('.na-cx').style.setProperty('--motor', 'var(--' + naEstado.motor + ')');
}

// atalhos das pastas que ele mais usa na VPS, para nao precisar digitar
const PASTAS_VPS = ['/opt/adsure', '/opt/adsure/wa', '/root', '/home/homero', '/var/www'];
function naPintarAtalhos() {
  const cx = $('#naAtalhos');
  if (!cx || cx.children.length) return;
  for (const p of PASTAS_VPS) {
    const b = document.createElement('button');
    b.className = 'na-atalho'; b.textContent = p;
    b.onclick = () => { $('#naCaminho').value = p; $('#naCaminho').focus(); };
    cx.appendChild(b);
  }
}

/* A mesma ideia dos atalhos da VPS, agora para o lado do Mac: um clique em vez da janela de
   pastas do macOS. A ordem e a de quem ele mais usa: a pasta padrao dos Ajustes, depois as
   pastas das conversas mais recentes, depois os clientes de Projetos-claude que faltarem.
   Teto de 12 botoes para a tela nao virar uma parede. */
const NA_MAX_ATALHOS = 12;
/* Cada desenho da fileira ganha um numero, igual ao da lista lateral. Ler os clientes do disco
   e uma ida ao main: clicar em duas pastas seguidas comecava o segundo desenho antes de o
   primeiro acordar, e os dois despejavam botao no mesmo lugar — a fileira aparecia dobrada. */
let naAtalhosVez = 0;
async function naPintarAtalhosMac() {
  const cx = $('#naAtalhosMac');
  if (!cx) return;
  const minhaVez = ++naAtalhosVez;
  const caminhos = [];
  const juntar = (p) => {
    if (!p || p === HOME || NA_VPS(p)) return;      // a VPS tem a fileira dela
    if (caminhos.length >= NA_MAX_ATALHOS || caminhos.includes(p)) return;
    caminhos.push(p);
  };
  juntar(cfg.defCwd);
  for (const c of todasAsConversas()) juntar(clienteDe(c.cwd));
  for (const c of await lerClientes()) juntar(c.path);
  if (minhaVez !== naAtalhosVez) return;   // ja tem um desenho mais novo: este morreu
  cx.innerHTML = '';                       // limpa so agora, com os botoes prontos pra entrar
  for (const p of caminhos) {
    const b = document.createElement('button');
    b.className = 'na-atalho' + (p === naEstado.pasta ? ' on' : '');
    b.textContent = nomeProjeto(p);
    b.title = p;
    b.onclick = () => { naEstado.pasta = p; naPintar(); naPintarAtalhosMac(); };
    cx.appendChild(b);
  }
}

function naConfirmar(dois) {
  if (!dois && motorIndisponivelNaPasta(naEstado.motor, naEstado.onde === 'vps' ? 'vps:/' : '')) { naPintar(); return; }
  let cwd;
  if (naEstado.onde === 'vps') {
    const p = ($('#naCaminho').value || '').trim() || '/opt/adsure';
    cwd = 'vps:' + (p.startsWith('/') ? p : '/' + p);
  } else {
    cwd = naEstado.pasta || HOME;
  }
  const el = $('#novaAba');
  el.dataset.travada = ''; el.classList.add('hidden');
  const A = novaAbaProjeto(cwd);
  if (dois) {
    const P = newPane({ engine: 'claude', aba: A });
    newPane({ engine: 'codex', aba: A });
    setFocus(P);
    setTimeout(() => $('.p-input', P.el).focus(), 80);
    return;
  }
  const P = newPane({ engine: naEstado.motor, aba: A });
  avisarInstalacaoMotor(P);
  cfg.lastEngine = naEstado.motor; window.api.setConfig(cfg);
  setTimeout(() => $('.p-input', P.el).focus(), 80);
}

// chat novo dentro da aba que esta aberta (mesma pasta, sem perguntar nada)
function novoChatNaAba(engine) {
  if (!abaAtiva) { telaNovaAba(); return; }
  engine = motorVisivel(engine || (focusPane && focusPane.engine) || cfg.lastEngine);
  const motivo = motorIndisponivelNaPasta(engine, abaAtiva.cwd);
  if (motivo) { if (focusPane) avisoTemp(focusPane, motivo, true); return; }
  const P = newPane({ engine, aba: abaAtiva });
  avisarInstalacaoMotor(P);
  igualarChats();
  setTimeout(() => $('.p-input', P.el).focus(), 60);
  return P;
}

$$('.na-motor').forEach(b => b.addEventListener('click', () => { naEstado.motor = b.dataset.motor; naPintar(); }));
$$('.na-onde').forEach(b => b.addEventListener('click', () => {
  naEstado.onde = b.dataset.onde; naPintarAtalhos(); naPintar();
  if (naEstado.onde === 'vps') setTimeout(() => $('#naCaminho').focus(), 40);
}));
$('#naPasta').addEventListener('click', async () => {
  // aba nova abre direto na pasta dos projetos do Claude (quem resolve o caminho e o main)
  const p = await window.api.pickFolder(naEstado.pasta || '');
  if (!p) return;
  naEstado.pasta = p; naPintar(); naPintarAtalhosMac();
});
$('#naPastaX').addEventListener('click', () => { naEstado.pasta = ''; naPintar(); naPintarAtalhosMac(); });
$('#naOk').addEventListener('click', () => naConfirmar(false));
$('#naCaminho').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); naConfirmar(false); } });
$('#naDois').addEventListener('click', () => naConfirmar(true));
if ($('#naCancela')) $('#naCancela').addEventListener('click', () => fecharNovaAba());
$('#novaAba').addEventListener('mousedown', (e) => { if (e.target.id === 'novaAba') fecharNovaAba(); });

/* ============ interface geral ============ */
// o + da barra de cima saiu: quem abre chat novo e o "+ chat" da barra de abas
$('#btnNovaAba').addEventListener('click', () => telaNovaAba());
$('#btnNovoChat').addEventListener('click', () => novoChatNaAba());
/* Aparência (redesenho 25/09): Automática / Clara / Escura. Quem resolve o data-theme do <html>
   (dark, light, dark-hc, light-hc) é o aparencia.js; aqui só entra a escolha salva. O que estava
   gravado antes do redesenho (escuro, claro, jornal) vira a opção nova mais próxima, e a
   escolha já migrada volta para o cfg, para a próxima gravação levar o nome novo ao disco.
   No Mac, gravar o cfg faz o main.js acertar o nativeTheme (barra de rolagem nativa e semáforos
   acompanham), e isso por sua vez dispara o evento 'cockpit:aparencia' logo abaixo. */
function aplicarTema(t) {
  const escolha = window.Aparencia ? window.Aparencia.aplicar(t)
    : (t === 'escura' || t === 'escuro' ? 'escura' : (t === 'clara' || t === 'claro' || t === 'jornal') ? 'clara' : 'auto');
  if (!window.Aparencia) document.documentElement.setAttribute('data-theme', escolha === 'clara' ? 'light' : 'dark');
  // so no Mac: no celular o web.js guarda o tema na gaveta do aparelho, e a migracao ali pareceria
  // um toque dele (e prenderia o celular numa escolha que ele nunca fez)
  if (!window.SEM_ELECTRON && cfg && cfg.tema !== undefined && cfg.tema !== escolha) cfg.tema = escolha;
  pintarCorFoco();
  pintarAparencia(escolha);
}
/* Aparência é um pop-up (26/09, como no desenho): um <select> de verdade, invisível, por cima do
   botão de 22. O clique abre o menu nativo do Mac (no iPhone, o seletor do sistema); o botão
   só mostra o nome da escolha. Antes era um seletor de três segmentos que não cabia ao lado do
   título e empurrava o cartão Geral para duas linhas. */
function pintarAparencia(escolha) {
  const sel = $('#selAparencia');
  if (!sel) return;
  sel.value = escolha;
  const txt = $('#aparenciaTxt');
  if (txt && sel.selectedIndex >= 0) txt.textContent = sel.options[sel.selectedIndex].textContent;
}
if ($('#selAparencia')) $('#selAparencia').addEventListener('change', async (e) => {
  cfg.tema = e.target.value;
  aplicarTema(cfg.tema);
  await window.api.setConfig(cfg);
});
// o Mac (ou o iPhone) trocou de claro para escuro, ou ligou o contraste: a cor já resolvida
// do chat em foco mudou junto, e a borda das abas lê essa cor
window.addEventListener('cockpit:aparencia', () => pintarCorFoco());

/* (i) dos Ajustes: um balão só, preso ao body, porque a coluna dos ajustes rola e cortaria
   um balão desenhado dentro dela. Mouse mostra; no celular (sem mouse) o toque liga e desliga. */
const SVG_INFO = ico('info');   // o (i) do redesenho (icones.js)
let dicaEl = null, dicaDono = null;
function mostrarDica(bt) {
  if (!dicaEl) {
    dicaEl = document.createElement('div');
    dicaEl.className = 'dica'; dicaEl.setAttribute('role', 'tooltip'); dicaEl.id = 'dicaAjustes';
    document.body.appendChild(dicaEl);
  }
  if (dicaDono && dicaDono !== bt) dicaDono.classList.remove('aberto');
  dicaDono = bt;
  bt.classList.add('aberto');
  bt.setAttribute('aria-describedby', 'dicaAjustes');
  dicaEl.textContent = bt.dataset.dica || '';
  dicaEl.classList.remove('on');
  dicaEl.style.left = '0px'; dicaEl.style.top = '0px';
  // mede já no tamanho final e só depois posiciona: embaixo do (i); sem espaço, em cima
  const r = bt.getBoundingClientRect(), d = dicaEl.getBoundingClientRect(), m = 8;
  const x = Math.max(m, Math.min(r.left - 10, innerWidth - d.width - m));
  let y = r.bottom + 6;
  if (y + d.height > innerHeight - m) y = Math.max(m, r.top - d.height - 6);
  dicaEl.style.left = x + 'px'; dicaEl.style.top = y + 'px';
  requestAnimationFrame(() => dicaEl && dicaEl.classList.add('on'));
}
function esconderDica() {
  if (dicaEl) dicaEl.classList.remove('on');
  if (dicaDono) { dicaDono.classList.remove('aberto'); dicaDono.removeAttribute('aria-describedby'); }
  dicaDono = null;
}
$$('.settings .info').forEach(bt => {
  bt.innerHTML = SVG_INFO;
  bt.addEventListener('mouseenter', () => mostrarDica(bt));
  bt.addEventListener('mouseleave', esconderDica);
  bt.addEventListener('focus', () => mostrarDica(bt));
  bt.addEventListener('blur', esconderDica);
  // clique não alterna: com mouse o balão já está aberto e sumiria no clique
  bt.addEventListener('click', (e) => { e.stopPropagation(); if (dicaDono !== bt) mostrarDica(bt); });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dicaDono) esconderDica(); });
document.addEventListener('click', () => { if (dicaDono) esconderDica(); });
if ($('.settings')) $('.settings').addEventListener('scroll', esconderDica, { passive: true });

/* caminho numa linha só, cortado pelo começo; o <bdi> segura a barra inicial no lugar */
function pintarCaminho(el, p) {
  if (!el) return;
  el.textContent = '';
  const b = document.createElement('bdi');
  b.textContent = p ? shortPath(p) : '—';   // "~/Projetos": o caminho inteiro fica na dica
  el.appendChild(b);
  el.title = p || '';
}

async function pintarWeb(st) {
  const box = $('#webInfo');
  if (!box) return;                      // no telefone essa parte dos ajustes nem existe
  if (!st || !st.ligado) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = '<b></b><br>Senha <b></b>';
  const [end, senha] = box.querySelectorAll('b');
  end.textContent = st.endereco || ''; senha.textContent = st.senha || '';
}
if ($('#chkWeb')) {
  $('#chkWeb').addEventListener('change', async (e) => {
    const st = await window.api.webLigar(e.target.checked);
    if (st && st.error) { alert('Não consegui abrir: ' + st.error); e.target.checked = false; return; }
    pintarWeb(st);
  });
}

/* Atalho global de ditar. A caixinha só existe no index.html do Mac — no telefone não há
   teclado do Mac para atalhar — então TODA linha aqui é guardada por `if ($(...))`, senão o
   boot do celular morria num TypeError (o app.js é o mesmo arquivo nos dois). */
if ($('#chkAtalhosGlobais')) {
  $('#chkAtalhosGlobais').addEventListener('change', async (e) => {
    cfg.atalhosGlobais = !!e.target.checked;
    await window.api.setConfig(cfg);
    try {
      const r = await window.api.atalhosLigar({ ligado: cfg.atalhosGlobais });
      pintarAvisoAtalhos(r);
    } catch (_) {}
  });
}
function pintarAvisoAtalhos(r) {
  const av = $('#atalhosAviso');
  if (!av) return;
  const falhos = (r && r.falhos) || [];
  av.textContent = falhos.length
    ? 'Outro programa já usa ' + falhos.join(', ') + '. Aqui vale só pelo menu (⌘⇧D).' : '';
  av.classList.toggle('hidden', !av.textContent);
}

$('#chkRobos').addEventListener('change', async (e) => {
  cfg.verRobos = e.target.checked;
  await window.api.setConfig(cfg);
  histCache.claude = null; histCache.codex = null;
  // 25/09: a lista e uma so; se ela estiver na frente, relê as duas IAs que têm robôs
  if (lateralAberta()) { loadHist('claude', true); loadHist('codex', true); }
});

/* A foto e mostrada num circulo de 20 a 30 pixels, mas era guardada no tamanho original: a
   foto atual ocupa 2,2 MB dentro do config.json, que e reescrito dezenas de vezes por dia e
   ainda viaja inteiro ate o iPhone. Reduzir para 256px deixa o arquivo em alguns KB sem
   nenhuma diferenca na tela. */
function encolherFoto(dataUrl, lado = 256) {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = lado;
        const g = c.getContext('2d');
        // JPEG nao tem transparencia: sem pintar o fundo antes, PNG transparente vira PRETO
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, lado, lado);
        const m = Math.min(img.width, img.height);          // corta quadrado pelo centro
        g.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, lado, lado);
        ok(c.toDataURL('image/jpeg', 0.88));
      } catch { ok(dataUrl); }
    };
    img.onerror = () => ok(dataUrl);
    img.src = dataUrl;
  });
}

$('#btnFoto').addEventListener('click', async () => {
  const r = await window.api.pickPhoto();
  if (!r) return;
  if (r.error) { alert(r.error); return; }
  cfg.foto = await encolherFoto(r.dataUrl); await window.api.setConfig(cfg); repintarAvatares();
});
$('#btnFotoTirar').addEventListener('click', async () => {
  delete cfg.foto; await window.api.setConfig(cfg); repintarAvatares();
});

$('#btnDefCwd').addEventListener('click', async () => {
  const p = await window.api.pickFolder(cfg.defCwd || HOME);
  if (!p) return;
  cfg.defCwd = p; await window.api.setConfig(cfg); pintarCaminho($('#defCwd'), p);
});

document.querySelectorAll('.act').forEach(b => b.addEventListener('click', () => {
  const v = b.dataset.view;
  const fechada = $('#sidebar').classList.contains('hidden');
  // clicar no icone que ja esta aberto fecha a coluna; se estava fechada, abre e carrega
  if (b.classList.contains('active') && !fechada) return toggleSidebar();
  $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden');
  document.querySelectorAll('.act').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.side-view').forEach(x => x.classList.toggle('hidden', x.dataset.view !== v));
  abrirVistaLateral(v);
}));

/* ===================== LEVA 10.2 — TORRE DE CONTROLE =====================
   Uma vista lateral com TODOS os chats de TODAS as abas (o que cada um está fazendo, há
   quanto tempo, se parou esperando você) mais as sessões do Claude que rodam FORA do Cockpit
   nesta máquina (VS Code, Terminal, robô agendado). Antes só havia uma bolinha por aba: com 4
   chats em 3 abas, saber qual estava travado esperando permissão exigia abrir uma por uma. */
let torreAgentes = { quando: 0, itens: [], erro: '', velha: false };
let torreGen = 0;   // repaint em voo: o mais novo ganha, o antigo não monta por cima
function torreVisivel() {
  const v = $('.side-view[data-view="torre"]'), lat = $('#sidebar');
  return !!v && !v.classList.contains('hidden') && !!lat && !lat.classList.contains('hidden');
}
const nomeMotor = (e) => ({ claude: 'Claude', codex: 'Codex', acp: 'ACP', gemini: 'Gemini', grok: 'Grok' }[e] || 'IA');

/* O estado sai do MESMO lugar que a tela usa, para os dois nunca discordarem: a tarja de
   permissão (`.pane-perm` sem `hidden`), as perguntas do Codex (`P.questions`), o `P.busy` e a
   legenda em `P.trabOque`. Nada de raspar o DOM: o `pintaTrab` daqui já escreve
   "1min 3s · pensando", e ler dali repetiria o tempo duas vezes na mesma linha. */
function estadoDoPainel(P) {
  const perm = P.el && $('.pane-perm', P.el);
  if (perm && !perm.classList.contains('hidden')) return { txt: 'esperando você autorizar', cls: 'espera' };
  if (P.questions) for (const q of P.questions.values()) {
    if (q && !q.done && q.el && q.el.isConnected) return { txt: 'esperando sua resposta', cls: 'espera' };
  }
  if (P.busy) {
    const desde = P.trabT0 || P.t0 || Date.now();
    return { txt: 'trabalhando há ' + duracaoCurta(Date.now() - desde) + (P.trabOque ? ' · ' + P.trabOque : ''), cls: 'ocupado' };
  }
  if (P.queued || (P.filaMsgs && P.filaMsgs.length)) return { txt: 'com mensagem na fila', cls: 'parado' };
  if (P.started) return { txt: 'parado, motor ligado', cls: 'parado' };
  if (P.hist && P.hist.length) return { txt: 'parado', cls: 'parado' };
  return { txt: 'vazio', cls: 'vazio' };
}
/* leva até o chat: troca de aba se precisar e põe o foco nele. Sem piscar (redesenho, README
   "Movimento": trocar de aba ou de chat é instantâneo) — quem mostra qual é o chat é o foco:
   o nome em --label-1 e a caixa de escrever com o anel. */
function irAoChat(P) {
  if (!P || !panes.has(P.id)) return;
  setFocus(P);
  const inp = $('.p-input', P.el); if (inp) inp.focus();
}
/* Linha da torre no desenho novo (25/09): logo da IA (a cor dela SÓ no logo) + título + linha de
   estado com o sinal na frente — anel girando = trabalhando, círculo âmbar com "!" = esperando
   você. Parado não tem sinal. O nome da IA saiu do título (o logo já diz) e foi para a dica.
   Sessão de FORA (com `caminho`): o caminho em mono + há quanto tempo, e os botões embaixo. */
function linhaDaTorre({ titulo, motor, estado, aoClicar, acoes, engine, foco, caminho, ha, nova }) {
  const d = document.createElement('div');
  d.className = 'torre-item ' + (estado.cls || '') + (foco ? ' foco' : '');
  d.innerHTML = '<span class="ti-logo"></span><span class="ti-txt"><span class="ti-cab"><span class="ti-tit"></span></span>'
    + '<span class="ti-est"><span class="ti-sinal"></span><span class="ti-est-txt"></span></span></span>';
  if (engine) { const lg = $('.ti-logo', d); lg.dataset.motor = engine; lg.innerHTML = svgMotor(engine); }
  // textContent, nunca innerHTML: título de conversa e caminho de pasta vêm de fora
  const tit = $('.ti-tit', d);
  if (caminho) {
    tit.textContent = caminho;
    tit.classList.add('ti-caminho');
    if (ha) { const q = document.createElement('span'); q.className = 'ti-ha'; q.textContent = ha; $('.ti-cab', d).appendChild(q); }
    $('.ti-est', d).remove();
  } else {
    tit.textContent = titulo;
    const txt = String(estado.txt || '');
    /* A linha de estado usa as palavras curtas do desenho (26/09): esperando = "Esperando você"
       (autorizar ou responder, o detalhe fica na dica), parado com o motor ligado = "Pronto".
       O estadoDoPainel continua dizendo a frase inteira: a tarja da faixa de avisos usa ela. */
    const curto = estado.cls === 'espera' ? 'esperando você' : txt === 'parado, motor ligado' ? 'pronto' : txt;
    // "trabalhando há 22s" vira "Trabalhando há 22s": a linha começa com maiúscula, como no desenho
    $('.ti-est-txt', d).textContent = curto.charAt(0).toUpperCase() + curto.slice(1);
    if (curto !== txt) $('.ti-est', d).title = txt.charAt(0).toUpperCase() + txt.slice(1);
    const sinal = $('.ti-sinal', d);
    /* ponto azul = resposta nova que ele ainda não viu (chegou com a aba dela no fundo). Pronto
       sem novidade não tem sinal: a ausência é o estado de repouso (folha do Sistema). */
    sinal.className = 'ti-sinal' + (estado.cls === 'ocupado' ? ' rd-anel' : estado.cls === 'espera' ? ' rd-espera'
      : nova && estado.cls === 'parado' ? ' rd-nova' : '');
    // a torre repinta de 4 em 4 s: o giro nasce na fase do relógio, senão o anel pularia a cada repintura
    if (estado.cls === 'ocupado') sinal.style.animationDelay = -(Date.now() % 1000) + 'ms';
  }
  if (aoClicar) { d.title = 'Ir até o chat' + (motor ? ' · ' + motor : ''); d.addEventListener('click', aoClicar); }
  else { d.classList.add('fora'); d.title = [titulo, motor].filter(Boolean).join(' · '); }
  /* Os botões vão numa LINHA PRÓPRIA, embaixo. Ao lado do texto eles comiam a largura inteira
     da coluna (medido: 206px de coluna, dois botões de ~170px) e o título ficava com zero
     pixel — a linha aparecia só com os botões, sem dizer de qual sessão era. */
  if ((acoes || []).length) {
    const fila = document.createElement('div');
    fila.className = 'ti-acoes';
    for (const ac of acoes) {
      const b = document.createElement('button');
      b.className = 'ti-acao';
      b.innerHTML = (ac.ic ? ico(ac.ic) : '') + '<span></span>';
      b.lastChild.textContent = ac.rotulo;
      b.title = ac.dica || '';
      b.addEventListener('click', (e) => { e.stopPropagation(); ac.aoClicar(b); });
      fila.appendChild(b);
    }
    d.appendChild(fila);
  }
  return d;
}
async function pintarTorre(forcarAgentes) {
  const box = $('#torre');
  if (!box) return;
  const gen = ++torreGen;
  // conversas que já estão abertas AQUI não entram na lista de "fora do Cockpit"
  const sessoesDaqui = new Set();
  for (const P of panes.values()) for (const s of [P.sessaoId, P.resumeId]) if (s) sessoesDaqui.add(s);

  const blocos = [];
  let total = 0, ocupados = 0, esperando = 0;
  for (const A of abas.values()) {
    const daAba = A.ordem.map((id) => panes.get(id)).filter(Boolean);
    if (!daAba.length) continue;
    const sec = document.createElement('div');
    sec.className = 'torre-aba';
    sec.innerHTML = '<span class="torre-cor"></span><span class="torre-nome"></span><span class="torre-conta"></span>';
    $('.torre-cor', sec).style.background = NA_VPS(A.cwd) ? 'var(--green)' : 'var(--accent)';
    $('.torre-nome', sec).textContent = nomeProjeto(A.cwd) + (NA_VPS(A.cwd) ? ' · VPS' : '');
    // 26/09: o grupo é só o nome da aba, como no desenho; a contagem foi para a dica
    sec.title = shortPath(A.cwd) + ' · ' + daAba.length + (daAba.length === 1 ? ' chat' : ' chats');
    blocos.push(sec);
    for (const P of daAba) {
      const e = estadoDoPainel(P);
      total++; if (e.cls === 'ocupado') ocupados++; if (e.cls === 'espera') esperando++;
      blocos.push(linhaDaTorre({
        titulo: P.titulo || 'sem título', motor: nomeMotor(P.engine), estado: e, aoClicar: () => irAoChat(P),
        engine: P.engine, foco: P === focusPane, nova: !!P.precisaRolar,
      }));
    }
  }
  /* A linha de resumo ("3 chats · 1 trabalhando · 1 esperando você") saiu da tela (26/09): o
     desenho põe o primeiro grupo logo abaixo do título, e cada linha já mostra o próprio estado.
     A conta foi para a dica do título. Sem chat aberto nenhum, a torre diz isso em vez de ficar
     em branco. */
  const cab = $('.side-view[data-view="torre"] .side-head > span');
  if (cab) {
    // no celular o título já tem uma dica própria: a conta entra embaixo dela, sem apagar
    if (cab.dataset.dica === undefined) cab.dataset.dica = cab.title || '';
    const conta = total
      ? total + (total === 1 ? ' chat' : ' chats') + ' · ' + ocupados + ' trabalhando' + (esperando ? ' · ' + esperando + ' esperando você' : '')
      : '';
    cab.title = [cab.dataset.dica, conta].filter(Boolean).join('\n');
  }
  box.innerHTML = '';
  if (!total) {
    const vazio = document.createElement('div');
    vazio.className = 'torre-resumo';
    vazio.textContent = 'Nenhum chat aberto';
    box.appendChild(vazio);
  }
  for (const b of blocos) box.appendChild(b);

  /* As sessões de FORA vêm pelo processo principal (`claude agents --json`), que já tem cache
     de 15s. Aqui o cache é de 30s e o desenho de cima já foi pintado: a lista de fora entra
     quando chegar, sem segurar o resto da tela. */
  if (forcarAgentes || Date.now() - torreAgentes.quando > 30000) {
    torreAgentes.quando = Date.now();
    try {
      const r = await window.api.agentesClaude();
      torreAgentes.itens = (r && Array.isArray(r.itens)) ? r.itens : [];
      torreAgentes.erro = (r && r.error) || '';
      torreAgentes.velha = !!(r && r.velho);
    } catch (e) { torreAgentes.erro = String((e && e.message) || e); }
    // outro repaint passou na frente enquanto a resposta vinha: refaz já com a lista que chegou
    if (gen !== torreGen) { if (torreVisivel()) pintarTorre(false); return; }
    if (!torreVisivel()) return;
  }
  const secFora = document.createElement('div');
  secFora.className = 'torre-aba torre-fora';
  secFora.innerHTML = '<span class="torre-nome"></span><span class="torre-conta"></span>';
  $('.torre-nome', secFora).textContent = 'Fora do app';
  const vistos = new Set();
  const fora = torreAgentes.itens.filter((a) => {
    // o mesmo número aparece duas vezes quando há subprocesso
    if (!a || !a.sessionId || sessoesDaqui.has(a.sessionId) || vistos.has(a.sessionId)) return false;
    vistos.add(a.sessionId); return true;
  });
  /* 26/09: com sessões na lista o grupo é só o nome, como no desenho, e a contagem vai para a
     dica. O lado direito só fala quando há algo fora do normal: lista vazia, lista que não veio
     ou lista velha (aí é estado, não contagem, e não pode ficar escondido). */
  secFora.title = 'Sessões do Claude rodando nesta máquina por fora daqui (Terminal, VS Code, robô agendado)'
    + (fora.length ? '\n' + fora.length + (fora.length === 1 ? ' sessão' : ' sessões') : '');
  $('.torre-conta', secFora).textContent = fora.length
    ? (torreAgentes.velha ? 'lista antiga' : '')
    : (torreAgentes.erro ? 'não consegui listar' : 'nenhuma');
  if (fora.length && torreAgentes.velha) $('.torre-conta', secFora).title = 'Não consegui atualizar: é a última lista que veio';
  box.appendChild(secFora);
  const COMO = { interactive: 'terminal / VS Code', background: 'segundo plano', subagent: 'subagente', sdk: 'via SDK', headless: 'sem tela' };
  for (const a of fora) {
    const ha = a.startedAt ? duracaoCurta(Date.now() - a.startedAt) : '';
    box.appendChild(linhaDaTorre({
      titulo: a.name || (String(a.cwd || '').split('/').filter(Boolean).pop()) || a.sessionId.slice(0, 8),
      motor: COMO[a.kind] || 'Claude',
      estado: { txt: shortPath(a.cwd) + (ha ? ' · há ' + ha : ''), cls: 'fora' },
      engine: 'claude', caminho: shortPath(a.cwd), ha: a.startedAt ? quandoCurto(a.startedAt) : '',
      acoes: [
        /* "command claude" de propósito: no shell dele `claude` é APELIDO de ssh para a VPS
           (~/.zshrc), então o comando copiado sem isso abriria a VPS em vez de continuar a
           conversa daqui. O `command` pula o apelido e chama o programa de verdade. */
        { rotulo: 'Copiar comando', ic: 'copy', dica: 'copia o "cd" + "claude --resume" para continuar essa conversa num terminal',
          aoClicar: (bt) => copiarTexto('cd "' + a.cwd + '" && command claude --resume ' + a.sessionId, bt) },
        ...(window.SEM_ELECTRON ? [] : [{ rotulo: 'Abrir pasta', ic: 'folder', dica: 'abre ' + shortPath(a.cwd) + ' no Finder', aoClicar: () => window.api.openPath(a.cwd) }]),
      ],
    }));
  }
}
/* Repinta sozinha enquanto estiver aberta. Com o mouse em cima não repinta: trocar o HTML
   embaixo do cursor cancelaria o clique que ele já começou a dar. */
setInterval(() => {
  const b = $('#torre');
  if (torreVisivel() && !(b && b.matches(':hover'))) pintarTorre(false);
}, 4000);

/* ===================== LEVA 11 — ROTINAS: os robôs agendados deste Mac =====================
   Os robôs que rodam sozinhos aqui (espelho da VPS, radar do painel, coletor do WhatsApp,
   vigia financeiro...). A tela existe por um motivo só: quando um deles para, ninguém fica
   sabendo — dá para ficar semanas em silêncio. Por isso o que quebrou vem PRIMEIRO, em
   vermelho e com o motivo em português; o resto da lista é só contexto.
   Quem sabe de tudo isto no Mac é o launchd, e é dele que o main tira a lista. */
let rotinasCache = { itens: [], erro: '', velha: false, quando: 0 };
let rotinasGen = 0;                    // repaint em voo: o mais novo ganha, o antigo não monta por cima
const rotinasDisparando = new Set();   // trava de duplo clique, uma chave por rotina
/* Neste Mac o launchd tem 550 serviços carregados, quase todos da Apple. Eles ficam no grupo
   recolhido — mas mesmo recolhido, ABRIR e depois repintar de minuto em minuto 500 linhas é o
   app virando o peso que veio medir. Pinta um teto e diz quantas ficaram de fora. */
const ROT_TETO_SISTEMA = 150;

function rotinasVisivel() {
  const v = $('.side-view[data-view="rotinas"]'), lat = $('#sidebar');
  return !!v && !v.classList.contains('hidden') && !!lat && !lat.classList.contains('hidden');
}

/* "hoje 08:15", "ontem 22:00", "25/08 08:56". Data crua não diz nada de relance, e o que se
   quer saber aqui é justamente "faz quanto tempo?". */
function quandoDaRotina(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const soODia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((soODia(new Date()) - soODia(d)) / 86400000);
  if (dias === 0) return 'hoje ' + hora;
  if (dias === 1) return 'ontem ' + hora;
  if (dias === -1) return 'amanhã ' + hora;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hora;
}

function linhaDaRotina(t) {
  /* Quem está RODANDO AGORA vem primeiro na conta: o "falhou" é o resultado da execução
     ANTERIOR, e dizer "falhou" de um robô que está trabalhando neste instante é chamar de
     quebrado o que está funcionando. O main já resolve isso; aqui só não se desfaz. */
  const rodando = t.estado === 'rodando';
  const cls = (rodando ? 'ocupado' + (t.residente ? '' : ' trabalhando') : t.falhou ? 'espera' : t.estado === 'desativada' ? 'fora' : 'parado');
  const d = document.createElement('div');
  d.className = 'rot-item ' + cls;
  /* desenho novo (25/09): sem bolinha colorida. Falha = triângulo vermelho na frente do nome;
     agendada rodando agora = o anel do "trabalhando" na frente do estado. O resto é texto. */
  d.innerHTML = '<span class="ri-txt"><span class="ri-nome"><span class="ri-alerta"></span><span class="ri-tit"></span></span>'
    + '<span class="ri-est"><span class="ri-sinal"></span><span class="ri-est-txt"></span></span><span class="ri-quando"></span></span>';
  if (t.falhou && !rodando) $('.ri-alerta', d).innerHTML = ico('warn');
  if (rodando && !t.residente) $('.ri-sinal', d).className = 'ri-sinal rd-anel';
  /* nome, motivo e horário vêm do launchd: entram por textContent, nunca por innerHTML — nome
     de serviço aceita < e & e viraria marcação na tela. */
  /* O prefixo é o mesmo em TODAS as dele (com.homero., com.adsure.) e come metade da coluna:
     com ele, "com.homero.ingresso-revisor" aparecia como "com.homero.ingresso-…" e não dava
     para saber de qual robô era a linha. Sai da tela, fica na dica e no aviso do disparo. */
  $('.ri-tit', d).textContent = t.dele ? t.nome.replace(/^com\.(homeromotti|homero|adsure)\./, '') : t.nome;
  /* Duas linhas curtas, como no desenho (26/09): o ESTADO ("Rodou bem", "Parou: sem acesso à
     pasta", "Rodando agora") e o HORÁRIO ("Última hoje 08:00 · próxima amanhã 08:00"). Antes o
     horário ia dentro do estado ("Parou de funcionar em hoje 00:11: …") e a linha vermelha
     quebrava em duas. */
  const ultima = quandoDaRotina(t.ultima);
  const proxima = quandoDaRotina(t.proxima);
  $('.ri-est-txt', d).textContent = rodando
    ? (t.residente ? 'ligada' : 'rodando agora')
    : t.falhou
      ? 'parou: ' + (t.motivo || 'motivo desconhecido')
      : t.estado === 'desativada' ? 'desativada'
      : ultima ? 'rodou bem' : 'sem registro de execução';
  const minuscula = (x) => x ? x.charAt(0).toLowerCase() + x.slice(1) : '';
  const quando = [
    ultima ? (rodando ? (t.residente ? 'desde ' : 'iniciou ') : 'última ') + ultima : '',
    // a ligada o tempo todo já diz isso no estado: repetir "fica ligada o tempo todo" é ruído
    proxima ? 'próxima ' + proxima : (rodando && t.residente) ? '' : minuscula(t.cadencia) || (ultima ? '' : 'sem hora marcada'),
  ].filter(Boolean).join(' · ');
  $('.ri-quando', d).textContent = quando;
  // a linha começa com maiúscula, como no desenho ("Rodou bem", "Última hoje 08:00 · próxima …")
  for (const el of [$('.ri-est-txt', d), $('.ri-quando', d)]) el.textContent = el.textContent.charAt(0).toUpperCase() + el.textContent.slice(1);
  // nome comprido corta com reticências na coluna estreita: o inteiro fica na dica
  d.title = t.nome + (t.caminho ? '  ·  ' + t.caminho : '');
  const bt = document.createElement('button');
  bt.className = 'ri-acao';
  bt.innerHTML = ico('play');   // ▶ de 26, como no desenho; o nome fica na dica e no leitor de tela
  bt.setAttribute('aria-label', 'Disparar agora');
  if (window.SEM_ELECTRON || t.podeDisparar === false) {
    /* Lista-negra do main (o próprio Cockpit, a ponte do WhatsApp, o executor, a rede da VPS):
       o botão fica à vista e explicado, em vez de sumir sem dizer por quê. */
    bt.disabled = true;
    bt.title = window.SEM_ELECTRON ? 'Disparar uma rotina só funciona no Mac.' : 'Esta não pode ser disparada daqui: ela derrubaria algo que está em uso agora';
  } else {
    bt.title = 'Roda esta rotina agora, sem esperar a hora marcada';
    // repaint no meio de um disparo não pode devolver o botão habilitado
    if (rotinasDisparando.has(t.nome)) { bt.disabled = true; bt.innerHTML = '<span class="rd-anel"></span>'; }
    bt.addEventListener('click', (e) => { e.stopPropagation(); dispararRotina(t, bt); });
  }
  d.appendChild(bt);
  return d;
}

/* Disparar dispara trabalho de verdade (o mesmo que a hora marcada dispararia): pergunta
   antes, e trava a rotina até o launchd responder, para o segundo clique não mandar duas
   vezes. */
async function dispararRotina(t, bt) {
  if (rotinasDisparando.has(t.nome)) return;
  if (!confirm('Rodar "' + t.nome + '" agora?\n\nIsso dispara a automação de verdade, na hora, como se fosse o horário marcado.')) return;
  rotinasDisparando.add(t.nome);
  if (bt) { bt.disabled = true; bt.innerHTML = '<span class="rd-anel"></span>'; bt.setAttribute('aria-label', 'Disparando…'); }
  let erro = '';
  try {
    const r = await window.api.rotinasDisparar({ nome: t.nome });
    erro = (r && r.error) || '';
  } catch (e) { erro = String((e && e.message) || e); }
  rotinasDisparando.delete(t.nome);
  mostrarAviso({
    id: 'rotina-' + t.nome,
    texto: erro ? 'Não consegui disparar "' + t.nome + '": ' + erro : '"' + t.nome + '" foi disparada agora.',
    tipo: erro ? 'erro' : 'info',
  });
  rotinasCache.quando = 0;   // o "ligada agora" tem que aparecer na próxima pintura
  if (rotinasVisivel()) pintarRotinas(true);
}

function grupoDeRotinas(nome, quantas, extra) {
  const g = document.createElement('div');
  g.className = 'rot-grupo';
  g.innerHTML = '<span class="rot-nome"></span><span class="rot-conta"></span>';
  $('.rot-nome', g).textContent = nome;
  $('.rot-conta', g).textContent = quantas + (quantas === 1 ? ' rotina' : ' rotinas') + (extra || '');
  return g;
}

/* Os serviços do macOS e dos programas instalados (Apple, Google, syncthing) entram num grupo
   próprio, RECOLHIDO. Não somem — um clique abre — mas saem do caminho: o bloco vermelho
   existe para ele ver as DELE, e aqui são 500 contra 33. */
let rotinasOutrasAbertas = false;
function cabecalhoDasOutras(quantas, quantasFalharam) {
  const g = grupoDeRotinas('Do sistema e de programas', quantas,
    quantasFalharam ? ' · ' + quantasFalharam + ' com falha' : '');
  g.classList.add('clicavel');
  const seta = document.createElement('span');
  seta.className = 'rot-seta';
  // marcação fixa do próprio app (nunca dado do launchd): innerHTML aqui é seguro
  seta.innerHTML = ico(rotinasOutrasAbertas ? 'chevron-down' : 'chevron-right');
  g.appendChild(seta);
  g.title = rotinasOutrasAbertas ? 'Esconder os serviços do sistema' : 'Mostrar os serviços do sistema';
  g.addEventListener('click', () => { rotinasOutrasAbertas = !rotinasOutrasAbertas; pintarRotinas(false); });
  return g;
}

async function pintarRotinas(forcar) {
  const box = $('#rotinas');
  if (!box) return;
  // a lista vem por IPC: pinta o que já tem em cache e atualiza quando a resposta chegar
  if (forcar || Date.now() - rotinasCache.quando > 20000) {
    /* A geração é SÓ de quem vai BUSCAR. Se todo repaint tomasse uma nova, o perdedor da
       corrida derrubaria a chamada BOA que ainda está em voo — ela voltaria, veria
       gen !== rotinasGen e iria para o lixo, deixando a tela dizendo "nenhuma rotina" numa
       máquina cheia delas. Repintar não invalida quem voa. */
    const gen = ++rotinasGen;
    rotinasCache.quando = Date.now();
    /* A leitura do launchd leva alguns décimos e a view abria EM BRANCO. O "lendo…" é o que
       separa "lento" de "quebrado". Só quando ainda não há lista nenhuma: por cima de uma
       lista pronta isso seria pisca-pisca a cada atualização. */
    if (!rotinasCache.itens.length && rotinasVisivel()) {
      box.innerHTML = '';
      const lendo = document.createElement('div');
      lendo.className = 'rot-carregando';
      lendo.textContent = 'Lendo os robôs agendados deste Mac…';
      box.appendChild(lendo);
    }
    let chegou = null, erroDaChamada = '';
    try { chegou = await window.api.rotinasListar(); }
    catch (e) { erroDaChamada = String((e && e.message) || e); }
    /* Resposta atrasada de uma busca ultrapassada por OUTRA não pode sobrescrever a lista mais
       nova — nem a tela, NEM o cache. Sai calada. */
    if (gen !== rotinasGen) return;
    if (erroDaChamada) rotinasCache.erro = erroDaChamada;
    else {
      rotinasCache.itens = (chegou && Array.isArray(chegou.itens)) ? chegou.itens : [];
      rotinasCache.erro = (chegou && chegou.error) || '';
      rotinasCache.velha = !!(chegou && chegou.velho);
    }
    pintarSeloRotinas();          // ANTES do return: o selo é justamente para quem não abriu a coluna
    if (!rotinasVisivel()) return;
  }
  const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  /* 'dele' pode faltar numa lista guardada por uma versão antiga: na dúvida a rotina é DELE,
     porque o erro de esconder é pior que o de mostrar demais. */
  const minhas = rotinasCache.itens.filter((t) => t.dele !== false);
  const doSistema = rotinasCache.itens.filter((t) => t.dele === false).sort(porNome);
  const falhas = minhas.filter((t) => t.falhou).sort(porNome);
  const resto = minhas.filter((t) => !t.falhou).sort(porNome);
  const falhasDoSistema = doSistema.filter((t) => t.falhou).length;
  const total = rotinasCache.itens.length;

  /* 26/09 (desenho novo): a conta vai para o cabeçalho, ao lado de "Rotinas" (só o número das
     DELE, que são as que a lista mostra), e o resumo por extenso ("… · nenhuma falha
     identificada") saiu da tela para a dica desse número. Na tela fica só o que é exceção: lista
     vazia, launchd que não respondeu, lista velha. */
  const resumoTxt = !total ? ''
    : total + (total === 1 ? ' rotina' : ' rotinas') + ' · '
      + (falhas.length
        ? falhas.length + (falhas.length === 1 ? ' sua parou de funcionar' : ' suas pararam de funcionar')
        : (falhasDoSistema ? 'nenhuma falha identificada nas suas' : 'nenhuma falha identificada'))
      + (falhasDoSistema ? ' · ' + falhasDoSistema + ' do sistema também' : '');
  const conta = $('#rotConta');
  if (conta) { conta.textContent = total ? String(minhas.length) : ''; conta.title = resumoTxt; }

  box.innerHTML = '';
  if (!total || rotinasCache.velha) {
    const resumo = document.createElement('div');
    resumo.className = 'rot-resumo';
    resumo.textContent = !total
      ? (rotinasCache.erro ? 'Não consegui ler o launchd deste Mac' : 'Nenhuma rotina agendada nesta máquina')
      : 'Lista antiga: não consegui atualizar';
    box.appendChild(resumo);
  }
  if (rotinasCache.erro && total) {
    const m = document.createElement('div');
    m.className = 'rot-resumo';
    m.textContent = rotinasCache.erro;
    box.appendChild(m);
  }
  // o bloco vermelho vem primeiro e fechado numa caixa própria: é o que a tela veio resolver,
  // não pode virar mais uma linha no meio de centenas
  if (falhas.length) {
    const cx = document.createElement('div');
    cx.className = 'rot-caixa';
    cx.appendChild(grupoDeRotinas('Parou de funcionar', falhas.length));
    for (const t of falhas) cx.appendChild(linhaDaRotina(t));
    box.appendChild(cx);
  }
  if (resto.length) {
    /* sem nenhuma parada as dele vêm logo abaixo do título, sem cabeçalho "Em dia" (o desenho
       não tem): o cabeçalho só existe para separar das que pararam, quando há alguma */
    if (falhas.length) box.appendChild(grupoDeRotinas('As outras suas', resto.length));
    for (const t of resto) box.appendChild(linhaDaRotina(t));
  }
  // as do sistema ficam recolhidas: presentes, contadas, fora do destaque
  if (doSistema.length) {
    box.appendChild(cabecalhoDasOutras(doSistema.length, falhasDoSistema));
    if (rotinasOutrasAbertas) {
      // as que falharam vêm na frente do teto: seria burrice cortar justo a linha que importa
      const ordem = doSistema.filter((t) => t.falhou).concat(doSistema.filter((t) => !t.falhou));
      for (const t of ordem.slice(0, ROT_TETO_SISTEMA)) box.appendChild(linhaDaRotina(t));
      if (ordem.length > ROT_TETO_SISTEMA) {
        const m = document.createElement('div');
        m.className = 'rot-resumo';
        m.textContent = '…e mais ' + (ordem.length - ROT_TETO_SISTEMA) + ' serviços do sistema, não mostrados aqui.';
        box.appendChild(m);
      }
    }
  }
}
/* 60 segundos, não 8: cada atualização acorda o launchd e lê 37 plists, e num Mac de 16 GB
   fazer isso a cada 8 s é o app cobrando mais do que entrega. Sem a guarda do :hover o botão
   "disparar" some debaixo do mouse no meio do clique, porque o repaint troca a linha inteira. */
setInterval(() => {
  const b = $('#rotinas');
  if (rotinasVisivel() && !(b && b.matches(':hover'))) pintarRotinas(false);
}, 60000);

/* ---- o aviso sai da coluna e vai para o ícone ----
   A coluna de Rotinas só lia o Mac enquanto estava aberta, e o ícone dela não tinha selo
   nenhum: a conta de quantos robôs dele pararam era feita e jogada fora quando ele fechava a
   coluna. Ou seja, o painel criado para avisar que um robô morreu só avisava quem já tinha
   ido olhar. Agora o número fica no ícone, e falha NOVA vira tarja na faixa de avisos. */
let rotinasFalhasVistas = null;   // null = primeira leitura; nela nada é "novo"

function pintarSeloRotinas() {
  const bt = $('.act[data-view="rotinas"]');
  if (!bt) return;
  const falhas = rotinasCache.itens.filter((t) => t.dele !== false && t.falhou);
  const selo = $('.act-selo', bt);
  if (selo) {
    selo.classList.toggle('hidden', !falhas.length);
    selo.textContent = falhas.length > 9 ? '9+' : String(falhas.length || '');
  }
  bt.title = falhas.length
    ? 'Rotinas · ' + falhas.length + (falhas.length === 1 ? ' parada' : ' paradas')
    : 'Rotinas: os robôs agendados que rodam sozinhos nesta máquina';
  /* Lista vazia = ainda não consegui ler o launchd nenhuma vez. Aí não se mexe no que já foi
     visto: senão a primeira leitura boa acusaria TODAS as falhas antigas como se fossem de
     agora, e ele abriria o Cockpit numa parede de tarjas. */
  if (rotinasCache.itens.length) avisarRotinaNova(falhas);
}

/* Robô que CAIU AGORA vira tarja, com o nome e o botão "ver". O primeiro giro do app não
   avisa nada: ali tudo seria "novo" e ele abriria o Cockpit numa parede de tarjas de falha
   velha, que é o oposto do que este aviso serve. */
function avisarRotinaNova(falhas) {
  const agora = new Set(falhas.map((t) => t.nome));
  if (rotinasFalhasVistas) {
    for (const t of falhas) {
      if (rotinasFalhasVistas.has(t.nome)) continue;
      // robô parado é erro (triângulo vermelho), como o "Parou: …" da coluna de Rotinas
      mostrarAviso({ id: 'rotina-' + t.nome, tipo: 'erro', fixo: true, acao: 'ver',
        aoClicar: abrirRotinas, texto: 'Rotina parada · ' + nomeCurtoDaRotina(t) });
    }
  }
  rotinasFalhasVistas = agora;
}

// o prefixo com.homero./com.adsure. come metade da tarja e é igual em todas as dele
const nomeCurtoDaRotina = (t) => String(t.nome || '').replace(/^com\.(homeromotti|homero|adsure)\./, '');

// abre a coluna de Rotinas como o clique no ícone — sem fechar se ela já estiver aberta ali
function abrirRotinas() {
  $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden');
  $$('.act').forEach(x => x.classList.toggle('active', x.dataset.view === 'rotinas'));
  $$('.side-view').forEach(x => x.classList.toggle('hidden', x.dataset.view !== 'rotinas'));
  abrirVistaLateral('rotinas');
}

/* De 5 em 5 minutos, com a coluna FECHADA, lê o launchd só para o selo e a tarja. Com a
   coluna aberta quem manda é o timer de 60s aí em cima — ele tem a guarda do :hover, que
   aqui faria falta (o repaint troca a linha inteira e o botão "disparar" some sob o mouse).
   No telefone não roda: quem tem robô agendado é este Mac. */
if (!window.SEM_ELECTRON) {
  setInterval(() => { if (!rotinasVisivel()) pintarRotinas(true); }, 300000);
  setTimeout(() => pintarRotinas(true), 8000);   // a 1ª leitura, sem disputar o boot
}

/* ===================== LEVA 10.4 — CHIP DO GIT NO CABEÇALHO =====================
   Mostra a branch da pasta deste chat e quantos arquivos estão mexidos. Clicar abre a lista,
   e cada arquivo abre o diff. Some sozinho fora de repositório e em chat da VPS (o git roda
   aqui no Mac; apontar para "vps:/..." mostraria a branch errada em silêncio). */
async function atualizarGit(P) {
  if (!P || !P.el) return;
  const chip = $('.p-git', P.el);
  if (!chip) return;
  if (NA_VPS(P.cwd)) { chip.classList.add('hidden'); return; }
  // no worktree o chip mostra a branch isolada (a pasta só nasce na 1ª mensagem)
  const pastaGit = pastaDoWorktree(P);
  // R3-042: 2 chamadas pro mesmo painel podem responder fora de ordem — a mais nova ganha
  P.gitGen = (P.gitGen || 0) + 1;
  const minhaVez = P.gitGen;
  let g = null;
  try { g = await window.api.gitStatus({ cwd: pastaGit }); } catch {}
  if (minhaVez !== P.gitGen) return;   // ja tem uma resposta mais nova: esta morreu
  if (!g || !g.branch) {
    if (P.worktree) {
      chip.classList.remove('hidden');
      chip.textContent = P.worktree + ' (a criar)';   // o ícone de branch é o ::before do chip
      chip.title = 'O worktree nasce na primeira mensagem deste chat';
      chip.onclick = null;
    } else chip.classList.add('hidden');
    return;
  }
  chip.classList.remove('hidden');
  const n = (g.arquivos || []).length;
  chip.textContent = g.branch + (n ? '  ±' + n : '');
  chip.title = n ? n + ' arquivo(s) alterado(s) — clique para ver' : 'Nada alterado nesta pasta';
  chip.onclick = (e) => {
    e.stopPropagation();
    if (!n) return;
    const pop = abrirPopGlobal(chip);
    for (const arq of g.arquivos.slice(0, 40)) {
      const nome = String(arq.nome || '');
      const it = popItem({ nome: (arq.estado || '?') + '  ' + (nome.split('/').pop() || nome) }, async () => {
        let texto = '';
        try { texto = await window.api.gitDiff({ cwd: pastaGit, arquivo: nome }); } catch {}
        mostrarDiffGit(P, nome, texto);
      });
      it.title = nome;                 // o caminho inteiro fica no balão do mouse
      pop.appendChild(it);
    }
  };
}
/* Reusa a janelinha larga da leva 2 (que já desfaz a marca do .modal-cx na saída — R9) e as
   MESMAS classes de linha do diff que o resto do app usa (.dl mais/menos/pula). */
function mostrarDiffGit(P, nome, texto) {
  const corpo = abrirJanelaLarga(P, nome);
  if (!texto || !texto.trim()) { corpo.innerHTML = '<div class="mo-carregando">Sem alterações para mostrar.</div>'; return; }
  const box = document.createElement('div');
  box.className = 'dif dif-git';
  for (const linha of String(texto).split('\n').slice(0, 4000)) {
    const l = document.createElement('div');
    const t = linha.startsWith('+') && !linha.startsWith('+++') ? 'mais'
      : linha.startsWith('-') && !linha.startsWith('---') ? 'menos'
      : (linha.startsWith('@@') || linha.startsWith('diff --git')) ? 'pula' : 'igual';
    l.className = 'dl ' + t;
    l.textContent = linha;
    box.appendChild(l);
  }
  corpo.appendChild(box);
}

/* ===================== LEVA 10.5 — CHAT EM WORKTREE =====================
   Fork de CÓDIGO, completando o de conversa: o chat passa a trabalhar numa branch isolada que
   o próprio Claude cria em .claude/worktrees/<nome>, dentro da pasta do chat. Gostou? faz o
   merge da branch. Não gostou? apaga a pasta e a principal nunca foi tocada. */
// a pasta onde o trabalho realmente acontece (a principal, ou a do worktree)
const pastaDoWorktree = (P) =>
  (P && P.worktree && !NA_VPS(P.cwd) ? String(P.cwd).replace(/\/+$/, '') + '/.claude/worktrees/' + P.worktree : (P ? P.cwd : ''));
// o rótulo do botão de pasta: o "⎇ nome" só aparece quando o chat está num worktree
const rotuloPasta = (P) => nomePasta(P.cwd) + (P && P.worktree ? '  ⎇ ' + P.worktree : '');
function mostrarPastaNoPainel(P) {
  if (P && P.el) pintarPasta(P, rotuloPasta(P));
}
/* A pasta virou ícone na barra da caixa de texto: o nome fica no balão do mouse, e o ⎇
   continua visível quando o chat está num worktree. */
function pintarPasta(P, rotulo) {
  const bt = P && P.el && $('.p-cwd', P.el);
  if (!bt) return;
  // pasta fechada do redesenho; em worktree, o ramo pequeno no canto (antes era o ⎇ de texto)
  bt.innerHTML = ico('folder') + (P.worktree ? '<span class="cwd-wt">' + ico('git-branch') + '</span>' : '');
  bt.title = rotulo + ' · clique para trocar a pasta deste chat';
  bt.setAttribute('aria-label', rotulo);
}
async function alternarWorktree(P) {
  // R3-040: abrir/sair de worktree corta o motor igual troca de motor — pergunta antes se está trabalhando
  if (!confirmarCorte(P, P.worktree ? 'Sair do worktree' : 'Abrir em worktree')) return;
  if (P.worktree) { await aplicarWorktree(P, ''); return; }   // sair sempre pode, em qualquer motor (so pergunta se ha trabalho em andamento)
  if (P.engine !== 'claude') { note(P, 'Worktree por aqui só no Claude: a flag -w é dele. Troque o motor deste chat para o Claude.', true); return; }
  if (NA_VPS(P.cwd)) { note(P, 'Worktree não vale em chat da VPS: a branch isolada seria criada no disco de lá, e quem confere o repositório é o Mac.', true); return; }
  /* Confere o repositório ANTES de perguntar o nome. O processo principal também confere (e
     recusa), mas lá a recusa só chega na PRIMEIRA mensagem: ele digitaria o pedido inteiro
     para depois descobrir que a pasta não é um repositório. */
  let repo = null;
  try { repo = await window.api.gitStatus({ cwd: P.cwd }); } catch {}
  if (!repo || !repo.branch) { note(P, 'A pasta deste chat não é um repositório git, e o worktree só funciona dentro de um. Troque a pasta do chat para uma que tenha git.', true); return; }
  const sugestao = 'exp-' + new Date().toISOString().slice(5, 10).replace('-', '');
  const nome = await perguntarTexto(P, 'Abrir em worktree',
    'Nome da branch isolada (letras, números, - e _). O Claude cria .claude/worktrees/<nome> dentro da pasta deste chat e trabalha lá; a pasta principal fica como está.', sugestao);
  if (nome == null) return;
  /* O corte em 40 letras vem ANTES das duas ultimas limpezas de proposito: cortando por ultimo,
     um nome comprido podia terminar em "." ou ".lock" DEPOIS do corte — e o git recusa esses
     dois. O chat ficaria achando que esta na branch isolada e estaria escrevendo na de verdade. */
  const limpo = String(nome).trim().replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-._]+/, '')
    .replace(/\.{2,}/g, '.').slice(0, 40).replace(/\.lock$/i, '').replace(/[.]+$/, '');
  if (!limpo) return;
  await aplicarWorktree(P, limpo);
}
async function aplicarWorktree(P, nome) {
  await desligarMotor(P);
  if (!panes.has(P.id)) return;                 // fechou o chat enquanto o motor parava
  P.worktree = nome || '';
  /* Worktree é outra árvore de arquivos: conversa nova, como na troca de pasta. Sem isso o
     --resume tentaria reabrir, dentro da branch nova, uma conversa que nasceu na antiga. */
  P.busy = false; P.queued = null; P.filaMsgs = []; escondePerm(P);
  pararTrabalho(P); limparPassos(P); limparContinuar(P);
  P.sessaoId = null; P.sessaoFile = ''; P.resumeId = null; P.forkPendente = false;
  P.passarContexto = null; P.edicoes = [];
  esquecerCadeiaDoPainel(P);   // 25/09: conversa nova de verdade, sem costura com a de antes
  zerarContexto(P);          // conversa nova: o medidor volta ao zero
  P.titulo = ''; P.nomeManual = false; P.nomeCurto = false; P.hist = []; limparPlano(P); limparSugestoes(P);
  P.blocks.clear(); P.tools.clear();
  P.started = false; setDot(P, 'off');
  voltarVazio(P);
  pintarNome(P);
  mostrarPastaNoPainel(P);
  atualizarGit(P);
  savePanes();
  avisoTemp(P, nome
    ? 'Worktree "' + nome + '": a próxima mensagem cria .claude/worktrees/' + nome + ' (branch worktree-' + nome + ') e trabalha lá. Gostou? faça o merge da branch. Não gostou? "git worktree remove --force .claude/worktrees/' + nome + '".'
    : 'Saiu do worktree: volta a trabalhar na pasta principal deste chat (conversa nova).');
}

/* ===================== LEVA 10.6 — RADAR DE VERSÃO DOS MOTORES =====================
   Confere uma vez por abertura se o motor instalado ficou para trás. Foi assim que se
   descobriu o Claude 13 versões atrás sem ninguém saber. */
const versaoMaisNova = (a, b) => {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pb[i] || 0) > (pa[i] || 0)) return true;
    if ((pb[i] || 0) < (pa[i] || 0)) return false;
  }
  return false;
};
/* No Mac o Cockpit NÃO executa o Claude que o `claude update` atualiza: ele roda uma cópia
   congelada em ~/.cockpit/bin/claude, refeita só no arranque do app (é o que faz o macOS
   parar de pedir permissão de disco a cada versão nova). Por isso o recado daqui é diferente
   do fork de origem: atualizar sem fechar e abrir o Cockpit não muda nada na tela.
   Aqui fica so o comando cru — ele vai para o botao "copiar comando" da faixa de avisos,
   para ele colar no Terminal se nao quiser esperar o Cockpit atualizar sozinho. */
const COMANDO_ATUALIZAR = {
  claude: 'claude update',
  codex: 'npm i -g @openai/codex',
};
async function checarVersoesDosMotores() {
  if (window.SEM_ELECTRON) return;              // no telefone não há o que atualizar
  let vs = null;
  try { vs = await window.api.motoresVersoes(); } catch { return; }
  if (!vs || typeof vs !== 'object') return;
  for (const eng of Object.keys(vs)) {
    const v = vs[eng];
    if (!v || !v.instalada || !v.ultima || !versaoMaisNova(v.instalada, v.ultima)) continue;
    /* Recado do APP, nao erro do agente. Antes isto caia em VERMELHO dentro da conversa em
       foco — mesma cor e mesmo lugar de uma falha do motor — e voltava toda manha, sem jeito
       de dispensar. Agora vai na faixa de avisos da janela, que e feita pra isso: tem botao,
       tem X e nao repete o que ele ja fechou. Sem painel em foco tambem funciona. */
    mostrarAviso({
      id: 'versao-' + eng,
      texto: nomeMotor(eng) + ' tem versão nova: ' + v.instalada + ' → ' + v.ultima
        + ' · o Cockpit atualiza sozinho em até 1 minuto',
      acao: COMANDO_ATUALIZAR[eng] ? 'copiar comando' : '',
      aoClicar: () => copiarTexto(COMANDO_ATUALIZAR[eng]),
    });
  }
}

function abrirVistaLateral(v) {
  // 25/09: uma vista só com as conversas de todas as IAs, e o uso do plano de cada uma no topo
  if (v === 'conversas') { recarregarConversas(); pintarUsoLateral(true); }
  // leva 10.2: a torre é sempre desenhada na hora — mostrar o estado de 4 segundos atrás
  // seria pior do que não mostrar nada
  if (v === 'torre') pintarTorre(true);
  // leva 11: mesma ideia da torre — estado de um minuto atrás não serve para dizer se um robô parou
  if (v === 'rotinas') pintarRotinas(true);
}

/* ⌘P: abre a coluna das conversas e ja poe o cursor na busca. A coluna que aparece e a do
   motor do chat em foco, mas o que for digitado procura nos QUATRO motores e no Mac inteiro
   — por isso as listas dos outros ja sao lidas aqui, antes de ele terminar de digitar.
   Nao passa pelo clique do icone de proposito: aquele caminho repinta a conta com
   forcar=true, e um "auth status" novo a cada aperto de ⌘P e lento e sem motivo. */
function abrirBuscaDeConversa() {
  // 25/09: a vista é a lista única (a de todas as IAs); a conta não é relida à força aqui
  $('#sidebar').classList.remove('hidden'); $('#dragbar').classList.remove('hidden');
  $$('.side-view').forEach(x => x.classList.toggle('hidden', x.dataset.view !== 'conversas'));
  recarregarConversas(); pintarUsoLateral();
  sincronizarIconesLaterais();
  const campo = $('.side-busca[data-busca="' + VISTA_CONVERSAS + '"]');
  if (campo) setTimeout(() => { campo.focus(); campo.select(); }, 60);
}

// enquanto a coluna estiver aberta, o limite se atualiza sozinho de 2 em 2 minutos
setInterval(() => {
  if ($('#sidebar').classList.contains('hidden')) return;
  if (!lateralAberta()) return;
  // 25/09: a vista única mostra o uso de todas: relê as duas que têm limite de sessão e semana
  for (const eng of ['claude', 'codex']) if (contaCache[eng]) lerUso(eng, true);   // o lerUso repinta a lateral
}, 120000);
/* 25/09: ele trocou de IA no celular e voltou para o Mac com a lateral aberta: a costura gravada
   la entra na lista na hora, sem precisar fechar e abrir a coluna (no celular quem faz isso e o
   voltou() do mobile.js). */
if (!window.SEM_ELECTRON) window.addEventListener('focus', () => {
  if (lateralAberta()) lerLigacoes().then(() => pintarConversas());
});
function toggleSidebar() {
  $('#sidebar').classList.toggle('hidden'); $('#dragbar').classList.toggle('hidden');
  sincronizarIconesLaterais();
  // abrindo pelo atalho de teclado, a vista que aparece precisa carregar a lista: antes
  // abria mostrando o que estivesse velho em cache, ou nada
  if (!$('#sidebar').classList.contains('hidden')) {
    const v = $$('.side-view').find(x => !x.classList.contains('hidden'));
    // sem forcar: abrir pelo atalho nao pode disparar um "claude auth status" novo toda vez
    if (v && v.dataset.view === 'conversas') { recarregarConversas(); pintarUsoLateral(); }
    // leva 10.2: abrindo a coluna pelo atalho, a torre também precisa nascer atualizada
    if (v && v.dataset.view === 'torre') pintarTorre(true);
  }
}

/* O icone aceso na barrinha da esquerda tem de dizer a verdade: so fica marcado quando a
   coluna esta ABERTA, e so o do lado que esta a mostra. Antes o "active" vinha escrito no
   HTML e nunca saia, entao o Claude aparecia selecionado com a coluna fechada, e continuava
   selecionado depois de fechar. */
function sincronizarIconesLaterais() {
  const fechada = $('#sidebar').classList.contains('hidden');
  const vista = fechada ? null : (($$('.side-view').find(v => !v.classList.contains('hidden')) || {}).dataset || {}).view;
  $$('.act').forEach(x => x.classList.toggle('active', !!vista && x.dataset.view === vista));
}


(() => {
  let drag = false;
  $('#dragbar').addEventListener('mousedown', () => { drag = true; document.body.style.cursor = 'col-resize'; });
  // a largura sai da borda esquerda REAL da coluna: o 48 fixo era a largura da barra de ícones,
  // que o redesenho muda (e o mínimo subiu para 220: abaixo disso pasta + busca não cabem lado a lado)
  window.addEventListener('mousemove', (e) => { if (drag) { const sb = $('#sidebar'); sb.style.width = Math.min(480, Math.max(220, e.clientX - sb.getBoundingClientRect().left)) + 'px'; } });
  window.addEventListener('mouseup', () => { drag = false; document.body.style.cursor = ''; });
})();

document.addEventListener('keydown', (e) => {
  /* ⌘1..⌘9 pula de ABA de projeto; ⌘⌥1..⌘⌥9 (e o ⌘⇧ de antes) pula de chat dentro da aba.
     Duas correcoes, e as duas sao a mesma historia: a tecla tem de FAZER o que a tela de
     atalhos promete.
     (1) quem diz qual numero foi apertado passou a ser e.code (Digit1..Digit9) e nao a letra
     que sairia na tela: com Shift ou Option segurados o Mac entrega '!' e '¡' no lugar de
     '1', entao o teste antigo por numero falhava justamente com modificador junto.
     (2) entrou o ⌘⌥ como caminho novo porque ⌘⇧3, ⌘⇧4 e ⌘⇧5 sao do proprio macOS (print da
     tela) e nunca chegam ate aqui. O ⌘⇧ continua valendo para nao tirar nada de ninguem, mas
     quem a tela de atalhos anuncia e o ⌘⌥, que e livre no Mac inteiro. */
  const numTecla = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
  const digito = numTecla ? numTecla[1] : (/^[1-9]$/.test(e.key) ? e.key : '');
  if ((e.metaKey || e.ctrlKey) && digito) {
    const n = Number(digito) - 1;
    if (e.altKey || e.shiftKey) {
      const A = abaAtiva; if (!A) return;
      const P = panes.get(A.ordem[n]);
      if (P) { e.preventDefault(); setFocus(P); $('.p-input', P.el).focus(); }
    } else {
      const A = [...abas.values()][n];
      if (A) { e.preventDefault(); ativarAbaProjeto(A); }
    }
  }
  /* ⌘/ SO onde nao ha menu do Mac (telefone/navegador). No app o dono e o item
     'Ver > Atalhos do teclado': com os dois vivos, um aperto abria e fechava a tela no mesmo
     instante e para ele o ⌘/ "nao fazia nada". Um atalho, um dono. */
  if (window.SEM_ELECTRON && (e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); alternarTelaAtalhos(); return; }
  // ⌘⇧E abre o quadro branco. No telefone nao ha menu do Mac: aqui e o unico caminho de teclado.
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    if (!focusPane || !window.Quadro) return;
    e.preventDefault();
    window.Quadro.abrir(focusPane);
    return;
  }
  // Esc fecha a tela de conversa nova (a nao ser que nao haja nenhuma aba aberta)
  if (e.key === 'Escape' && !$('#novaAba').classList.contains('hidden')) { e.stopPropagation(); fecharNovaAba(); }
  // Enter confirma direto: sem pasta escolhida, abre no Mac inteiro
  if (e.key === 'Enter' && !$('#novaAba').classList.contains('hidden')) {
    // se o Enter nasceu dentro de um campo DESTA tela, o campo trata sozinho: este tratador
    // roda na captura, ANTES do campo, e os dois chamavam naConfirmar — UM Enter abria DUAS
    // abas. Campo de fora nao conta: o cursor costuma ficar no chat de tras, e ai o Enter
    // tem de confirmar a tela que esta na frente.
    if (e.target && e.target.closest && e.target.closest('#novaAba input, #novaAba textarea')) return;
    // Enter com o foco no Cancelar e do Cancelar (o clique nativo do botao fecha a tela)
    if (e.target && e.target.id === 'naCancela') return;
    // e o Enter para aqui: sem isto ele descia ate o campo de escrever escondido atras da tela
    e.preventDefault(); e.stopPropagation(); naConfirmar(false);
  }
}, true);

/* Digitou fora do campo? O texto vai para o campo do chat em foco.
   Sem isto, quem clica na conversa para rolar e volta a digitar escreve no vazio — e para ele
   isso e "o app travou". Toda camada que usa letra solta esta barrada na lista abaixo; camada
   nova tem que entrar aqui tambem. */
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!e.key || e.key.length !== 1) return;
  const alvo = e.target;
  if (alvo && alvo.closest && alvo.closest('input, textarea, [contenteditable="true"], .term-wrap')) return;
  if (window.Quadro && window.Quadro.aberto && window.Quadro.aberto()) return;
  if (!$('#novaAba').classList.contains('hidden')) return;
  const telaAt = $('#telaAtalhos');           // no telefone essa tela pode nem existir
  if (telaAt && !telaAt.classList.contains('hidden')) return;
  if (agPainelAberto()) return;
  if ([...panes.values()].some(P => !$('.p-modal', P.el).classList.contains('hidden'))) return;
  if (!focusPane) return;
  const inpFoco = $('.p-input', focusPane.el);
  if (inpFoco && document.activeElement !== inpFoco) inpFoco.focus();
});

window.addEventListener('resize', () => { for (const P of panes.values()) paintEngine(P); });

/* ---- Lista de atalhos (⌘/) ----
   REGRA: so pode entrar aqui o que FAZ o que a linha diz. Uma tela de ajuda mentindo e pior
   do que nao ter tela nenhuma. Quem mexer em atalho tem de mexer nesta lista junto.
   Cada linha: [tecla, o que faz por extenso, rotulo curto]. Na tela vai so o rotulo curto (a
   coluna tem 272 e nada pode sair cortado com "…"); o texto por extenso mora no balao do mouse
   e na busca. Sem rotulo curto, a tela usa o texto por extenso.
   Ordem dos grupos = grade de 3 colunas: o Quadro (o grupo mais comprido) sobe para a 1a fila,
   ao lado dos outros dois compridos, e a tela fica 2 linhas mais baixa. */
const ATALHOS = [
  ['Chats e abas', [
    ['⌘T', 'Novo chat nesta aba'],
    ['⌘⇧T', 'Nova aba de projeto'],
    ['⌘W', 'Fechar o chat (com janelinha aberta, fecha a janelinha primeiro)', 'Fechar o chat'],
    ['⌘⇧W', 'Reabrir o último chat fechado'],
    ['⌘1 … ⌘9', 'Pular de aba de projeto'],
    ['⌘⌥1 … ⌘⌥9', 'Pular de chat dentro da aba'],
    ['⌘O', 'Trocar a pasta deste chat'],
    ['⌘B', 'Mostrar/esconder a coluna de conversas', 'Coluna de conversas'],
    ['⌘⇧F', 'Modo foco: só pergunta e resposta', 'Modo foco'],
  ]],
  ['Escrever', [
    ['Enter', 'Enviar'],
    ['⇧Enter', 'Pular linha'],
    ['Tab', 'Recuo de 2 espaços (o cursor não sai do campo)', 'Recuo de 2 espaços'],
    ['⌘A', 'Selecionar tudo do campo'],
    ['⌘Z / ⌘⇧Z', 'Desfazer / refazer (⌘Y também refaz)', 'Desfazer / refazer'],
    ['⌘⇧D', 'Ditar: falar em vez de digitar', 'Ditar'],
    ['Esc', 'Fecha o que estiver aberto; com pedido de autorização, nega; sem nada, para a IA deste chat', 'Fechar ou parar'],
    ['↑ / ↓', 'Com o campo vazio, traz de volta o que você já mandou (as 50 últimas)', 'Mensagens já enviadas'],
    ['letra solta', 'Digitar fora do campo joga o texto no campo deste chat', 'Escrever de qualquer lugar'],
  ]],
  ['Quadro branco', [
    ['⌘⇧E', 'Abrir o quadro branco'],
    ['V H R O D N T A L P E', 'Trocar de ferramenta', 'Ferramentas'],
    ['0 · + · −', 'Enquadrar e dar zoom — SEM Command (com ⌘ quem muda de tamanho é o app)', 'Enquadrar e zoom'],
    ['Alt+D', 'Duplicar o que está selecionado', 'Duplicar'],
    ['Delete', 'Apagar'],
    ['setas (⇧ anda mais)', 'Mover a peça (com ⇧ anda mais)', 'Mover a peça'],
    ['[ e ]', 'Mandar pra trás / pra frente', 'Para trás / para frente'],
    ['Espaço', 'Arrastar a tela (segurando o Espaço)', 'Arrastar a tela'],
    ['Enter', 'Editar o texto da peça'],
    ['⌘Enter', 'Mandar o desenho pro chat'],
    ['Esc', 'Fecha uma camada por vez', 'Fechar uma camada'],
  ]],
  ['Ler e copiar', [
    ['PageUp / PageDown', 'Rolar a conversa sem tirar o cursor do campo', 'Rolar a conversa'],
    ['⌘F', 'Buscar na conversa (Enter vai pro próximo, ⇧Enter volta)', 'Buscar na conversa'],
    ['⌘P', 'Buscar conversa nos quatro motores e no Mac inteiro', 'Buscar em todas as conversas'],
    ['⌘A depois ⌘C', 'Copiar a conversa inteira, com os comandos', 'Copiar a conversa inteira'],
    ['⌘K', 'Limpar a tela (a conversa continua de onde estava)', 'Limpar a tela'],
    ['⌘S', 'Salvar a conversa no Obsidian'],
    ['⌘D', 'Perguntar aos outros motores desta aba', 'Perguntar aos outros motores'],
  ]],
  ['Terminal embutido', [
    ['Ctrl+C', 'Cancelar o que está rodando'],
    ['⌘K', 'Limpar o terminal (não a conversa)', 'Limpar o terminal'],
    ['⌘A depois ⌘C', 'Selecionar e copiar o terminal', 'Copiar o terminal'],
    ['⌘W', 'Fechar a janelinha do terminal', 'Fechar o terminal'],
  ]],
  // pedido de autorização à vista no chat em foco (teclaDoPedido); o Enter só com o campo vazio
  ['Autorização', [
    ['Enter', 'Permitir (com o campo vazio)', 'Permitir'],
    ['Esc', 'Negar'],
    ['Alt+Enter', 'Sempre permitir (quando o pedido oferece)', 'Sempre permitir'],
  ]],
];

/* A tecla no desenho do Mac, como nos menus do sistema (⌃ ⌥ ⇧ ⌘ nessa ordem, ↩ ⇥ ⌫ esc).
   So muda o que aparece: a lista acima continua escrita do jeito que o dedo le. */
const ORDEM_MODIF = '⌃⌥⇧⌘';
function teclaDoMac(t) {
  let k = String(t)
    .replace(/^setas.*$/, '← ↑ → ↓')
    .replace(/^PageUp \/ PageDown$/, '⇞ ⇟')
    .replace(/^\[ e \]$/, '[ ]')
    .replace(/^letra solta$/, 'a–z')
    .replace(/\bAlt\+/g, '⌥').replace(/\bCtrl\+/g, '⌃')
    .replace(/\bDelete\b/g, '⌫').replace(/Enter/g, '↩').replace(/\bTab\b/g, '⇥').replace(/\bEsc\b/g, 'esc')
    .replace(/ depois /g, ' ').replace(/ \/ /g, '  ');
  // modificadores na ordem do Mac: ⌘⇧T → ⇧⌘T, ⌘⌥1 → ⌥⌘1
  k = k.replace(/[⌃⌥⇧⌘]{2,}/g, (m) => [...m].sort((a, b) => ORDEM_MODIF.indexOf(a) - ORDEM_MODIF.indexOf(b)).join(''));
  // faixa: ⌘1 … ⌘9 → ⌘1–9
  return k.replace(/([⌃⌥⇧⌘]*)(\d) … \1(\d)/, '$1$2–$3');
}

function alternarTelaAtalhos() {
  const tela = $('#telaAtalhos');
  if (!tela) return;                          // tela que nao existe nao abre nem estoura
  if (!tela.classList.contains('hidden')) { tela.classList.add('hidden'); return; }
  const lista = $('#atLista');
  if (!lista) return;
  lista.innerHTML = '';
  for (const [grupo, linhas] of ATALHOS) {
    const g = document.createElement('div');
    g.className = 'at-gr';
    const n = document.createElement('div');
    n.className = 'at-gr-n'; n.textContent = grupo;
    g.appendChild(n);
    for (const [tecla, oque, rotulo] of linhas) {
      const l = document.createElement('div');
      l.className = 'at-l';
      /* Redesenho (25/09): o que a tecla faz a esquerda, a tecla a direita, uma linha so. Na
         tela vai o rotulo curto; a explicacao (parenteses, travessao, ponto e virgula) fica no
         balao do mouse (regra dele: so rotulo na tela). */
      const curto = rotulo || oque.split(/ \(| — |; /)[0];
      const d = document.createElement('span'); d.className = 'at-d'; d.textContent = curto;
      // a tecla no desenho do Mac; o nome por extenso fica no balão
      const k = document.createElement('span'); k.className = 'at-k';
      k.textContent = teclaDoMac(tecla);
      l.title = tecla + '  ' + oque;
      l.dataset.busca = (tecla + ' ' + oque + ' ' + grupo).toLowerCase();
      l.appendChild(d); l.appendChild(k);
      g.appendChild(l);
    }
    lista.appendChild(g);
  }
  // busca da lista: esconde a linha que nao casa e o grupo que ficou vazio (so aparencia)
  const busca = $('#atBusca');
  if (busca) {
    const ic = $('.at-busca-ic'); if (ic && !ic.innerHTML) ic.innerHTML = ico('search');
    busca.value = '';
    busca.oninput = () => {
      const q = busca.value.trim().toLowerCase();
      for (const g of lista.children) {
        let algum = false;
        for (const l of g.querySelectorAll('.at-l')) {
          const casa = !q || l.dataset.busca.includes(q);
          l.classList.toggle('hidden', !casa);
          if (casa) algum = true;
        }
        g.classList.toggle('hidden', !algum);
      }
    };
  }
  tela.classList.remove('hidden');
  /* abre com o cursor no "Buscar atalho": com a tela aberta a letra solta e barrada de proposito
     (o teclado nao vai para o chat de tras), entao sem o foco aqui digitar nao fazia nada */
  if (busca) busca.focus({ preventScroll: true });
}

/* QUEM GANHA A TECLA, do mais perto do dedo para o mais longe. (1) Campo de texto em foco —
   textarea, input ou a caixa do quadro — fica com tudo que e edicao: letras, setas, Tab, Enter,
   ⌘A/⌘Z/⌘C/⌘V; o que nao for edicao ele deixa subir. (2) Terminal embutido em foco fica com Esc,
   Ctrl+letra, ⌘K, ⌘F e ⌘A, que ali sao do shell, e o primeiro ⌘W fecha a janelinha, nao o chat.
   (3) Quadro branco aberto fica com o teclado inteiro enquanto estiver na frente: nenhuma acao de
   painel (abrir/fechar chat, limpar, buscar, lateral, foco) pode rodar por tras dele. (4) O app
   fica com o que sobrou: ⌘1-9, os itens do menu e as teclas de janela. Duas leis fecham a regra:
   quem tratou a tecla PARA a tecla (preventDefault + stopPropagation), para nunca haver dois donos
   no mesmo aperto; e no macOS o item de menu com acelerador SEMPRE come a tecla antes da pagina,
   entao atalho que precisa chegar na pagina nao pode existir tambem no menu. */

/* ---- Desfazer / Refazer / Selecionar tudo que vem do menu do Mac ----
   No macOS o menu do aplicativo fica com ⌘Z, ⌘⇧Z e ⌘A, e o papel pronto do Electron so sabe
   desfazer DENTRO de um campo de texto: dentro do quadro branco o desfazer morria. Agora o menu
   avisa a tela e o destino e decidido aqui. O guarda de tempo existe porque, se um dia a tecla
   passar a chegar tambem na pagina, o desfazer andaria DOIS passos de uma vez. */
const ultimaTeclaEdicao = { desfazer: 0, refazer: 0, selecionarTudo: 0 };
let teclaSintetica = false;    // a tecla que EU devolvo pro quadro nao conta como tecla dele
window.addEventListener('keydown', (e) => {
  /* So conta a tecla do MENU. No Mac o acelerador e o Command; o Control ali e outra coisa
     completamente: Ctrl+A e "ir para o comeco da linha", Ctrl+Y e "colar do kill ring".
     Contando o Control como se fosse o menu, um Ctrl+A sem querer aposentava o ⌘A — que no
     Mac so existe pelo menu — e ele ficava sem selecionar tudo. */
  const EH_MAC = navigator.platform.indexOf('Mac') === 0;
  const teclaDoMenu = EH_MAC ? e.metaKey : e.ctrlKey;
  if (teclaSintetica || !teclaDoMenu || (EH_MAC && e.ctrlKey)) return;
  const k = (e.key || '').toLowerCase();
  let acao = '';
  if (k === 'z') acao = e.shiftKey ? 'refazer' : 'desfazer';
  /* ⌘Y (o habito de Windows dele) nao existe no menu, entao a tecla chega aqui de verdade.
     Antes so anotava a hora e nao refazia nada — e ainda envenenava o carimbo, matando o ⌘⇧Z
     do menu logo depois. Com o quadro aberto quem refaz e o proprio quadro (quadro.js trata
     ⌘Y): fazer aqui tambem andaria DOIS passos num aperto so. */
  else if (k === 'y') {
    if (window.Quadro && window.Quadro.aberto && window.Quadro.aberto()) return;
    e.preventDefault(); acao = 'refazer'; aplicarEdicao('refazer');
  }
  else if (k === 'a') acao = 'selecionarTudo';
  if (!acao) return;
  ultimaTeclaEdicao[acao] = Date.now();
  /* 🔴 O carimbo acima cala o recado do menu pelos proximos 150ms — entao quem carimba TEM de
     fazer o trabalho. Antes so anotava a hora e nao selecionava nada: sempre que a tecla chegava
     aqui (e ela chega, dependendo de onde esta o foco), o ⌘A ficava morto nos dois caminhos —
     a pagina nao fazia, e o menu era ignorado. Foi exatamente a queixa dele.
     Excecao: com o quadro aberto quem trata e o proprio quadro, que tem a pilha dele e ja escuta
     a tecla no document; fazer aqui tambem andaria dois passos num aperto so. */
  if (window.Quadro && window.Quadro.aberto && window.Quadro.aberto()) return;
  e.preventDefault();
  aplicarEdicao(acao);
}, true);

/* Se a tecla chegou na pagina ha pouco, a pagina e a dona e o menu fica quieto (senao o desfazer
   andaria DOIS passos por aperto). A espera curta cobre o contrario: o recado do menu chegar um
   fio antes da tecla. E a janela EXPIRA de proposito — uma tecla perdida nao pode aposentar o
   caminho do menu, que no Mac de hoje e o unico que existe. */
/* SEM espera: o ⌘A tem que valer no mesmo instante. Com 120ms de atraso, ⌘A+Colar e
   ⌘A+Backspace (o gesto mais comum do campo) rodavam ANTES do selecionar tudo — o colado
   emendava em vez de substituir. No Mac o acelerador do menu come a tecla, entao ela nunca
   chega na pagina primeiro; e se um dia chegar, chega ANTES do recado (mesmo processo,
   contra dois saltos de IPC) e o guarda abaixo continua evitando o desfazer duplo. */
/* 150ms cobre a corrida do MESMO aperto (a tecla e o recado do menu chegando juntos).
   Os 5 segundos de antes aposentavam o atalho: uma tecla perdida deixava o ⌘A morto por
   5 segundos inteiros — que e exatamente a reclamacao de "nao consigo dar ⌘A". */
const DONO_DA_PAGINA = 150;
function edicaoDoMenu(acao) {
  if (Date.now() - (ultimaTeclaEdicao[acao] || 0) < DONO_DA_PAGINA) return;
  aplicarEdicao(acao);
}

/* Quem esta em foco AGORA e o terminal embutido? Devolve o registro dele (ou null).
   No macOS o item de menu come a tecla antes do xterm, entao ⌘A/⌘K/⌘C caiam na pagina de tras:
   o ⌘A nao selecionava nada (o execCommand ia parar no textarea escondido do xterm, vazio) e o
   ⌘K limpava a CONVERSA em vez do terminal. Nao da para devolver a tecla ao xterm — o conserto
   e o recado do menu perguntar quem esta na frente. */
function termEmFoco() {
  const cx = document.activeElement && document.activeElement.closest && document.activeElement.closest('.term-wrap');
  if (!cx) return null;
  for (const r of termsVivos.values()) {
    if (r.term && r.term.element && cx.contains(r.term.element)) return r;
  }
  return null;
}

function aplicarEdicao(acao) {
  const rTerm = termEmFoco();
  if (rTerm) {
    if (acao === 'selecionarTudo') { try { rTerm.term.selectAll(); } catch (_) {} return; }
    return;   // desfazer/refazer nao existem no terminal: nao mexer na pagina por tras
  }
  if (window.Quadro && window.Quadro.aberto && window.Quadro.aberto()) {
    // o quadro tem a propria pilha de desfazer: devolvo a tecla para ele mesmo tratar
    const t = { desfazer: { key: 'z' }, refazer: { key: 'z', shift: true }, selecionarTudo: { key: 'a' } }[acao];
    if (!t) return;
    teclaSintetica = true;
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: t.key, code: t.key === 'z' ? 'KeyZ' : 'KeyA',
        metaKey: true, shiftKey: !!t.shift, bubbles: true, cancelable: true,
      }));
    } catch (_) {} finally { teclaSintetica = false; }
    return;
  }
  /* ⌘A fora de campo de texto: o execCommand('selectAll') pega o DOCUMENTO inteiro — com dois
     chats lado a lado ele copiava a conversa dos DOIS e ainda levava o rascunho que estava no
     campo sem ter sido enviado. Aqui a selecao e montada na mao so na conversa do chat em foco;
     o campo de escrever fica de fora porque nao entra no range. */
  if (acao === 'selecionarTudo') {
    const at = document.activeElement;
    const emCampo = at && at.closest && at.closest('input, textarea, [contenteditable="true"]');
    const conversa = focusPane && focusPane.el && $('.pane-chat', focusPane.el);
    if (!emCampo && conversa) {
      try {
        const r = document.createRange();
        r.selectNodeContents(conversa);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(r);
      } catch (_) {}
      return;
    }
  }
  // fora do quadro vale o de sempre: desfazer/refazer/selecionar tudo do campo em foco
  const cmd = { desfazer: 'undo', refazer: 'redo', selecionarTudo: 'selectAll' }[acao];
  try { document.execCommand(cmd); } catch (_) {}
}

window.api.onMenu(acaoDeMenu);

function acaoDeMenu(a) {
  /* Porteiro: o que esta na frente manda. Nenhuma acao de painel pode agir por tras do
     quadro branco — ele tapa a tela inteira e ele nao ve o estrago. Antes, com o quadro
     aberto, ⌘W fechava em silencio o chat de tras e deixava o desenho preso a um chat que
     nao existia mais. Desfazer/refazer/selecionar tudo e a tela de atalhos NAO entram aqui:
     esses tem que continuar chegando. */
  const ACOES_DO_PAINEL = ['newPane', 'newTab', 'closePane', 'reabrirFechado', 'pickFolder', 'clearPane',
    'buscarNaConversa', 'buscarConversa', 'perguntarAosDois', 'ditar', 'salvarVault', 'toggleSidebar', 'foco'];
  if (window.Quadro && window.Quadro.aberto && window.Quadro.aberto() && ACOES_DO_PAINEL.includes(a)) return;
  if (a === 'atalhos') return alternarTelaAtalhos();
  if (a === 'desfazer' || a === 'refazer' || a === 'selecionarTudo') return edicaoDoMenu(a);
  // clicou no recado do sistema: traz a aba e o chat que ficaram prontos para a frente
  // (sem piscar: a troca é instantânea, README "Movimento")
  if (a.startsWith('ir:')) {
    const P = panes.get(a.slice(3));
    if (!P) return;
    const A = abaDe(P);
    if (A && A !== abaAtiva) ativarAbaProjeto(A);
    setFocus(P);
    $('.p-input', P.el).focus();
    return;
  }
  if (a === 'foco') { const on = alternarFoco(); if (focusPane) avisoTemp(focusPane, on ? 'Modo foco ligado: só pergunta e resposta.' : 'Modo foco desligado.'); return; }
  if (a === 'reabrirFechado') return reabrirUltimoFechado();
  if (a === 'buscarNaConversa') return abrirBuscaConversa(focusPane);
  if (a === 'buscarConversa') return abrirBuscaDeConversa();
  if (a === 'perguntarAosDois') return focusPane && perguntarAosOutros(focusPane);
  if (a === 'ditar') return focusPane && alternarDitado(focusPane);
  if (a === 'quadro') {
    // R2-025: avisa o main.js se abriu de verdade — sem painel em foco, focusPane e null e nada abre
    // R3-007: Quadro.abrir e assincrona (Promise sempre truthy); so avisa quando ela
    // resolver de verdade, com o valor booleano real (nao mais !!Promise)
    if (focusPane && window.Quadro) {
      Promise.resolve(window.Quadro.abrir(focusPane)).then((abriu) => {
        if (window.api && window.api.quadroAbriu) window.api.quadroAbriu(!!abriu);
      });
      return true;
    }
    if (window.api && window.api.quadroAbriu) window.api.quadroAbriu(false);
    return false;
  }
  if (a === 'salvarVault') return focusPane && salvarConversaNoVault(focusPane);
  if (a === 'newPane') novoChatNaAba();
  else if (a === 'newTab') telaNovaAba();
  else if (a === 'closePane' && focusPane) {
    // com o terminal embutido aberto, o primeiro ⌘W fecha a JANELINHA. Antes ele fechava o
    // chat inteiro e matava o terminal junto, no meio de um login de CLI.
    const m = $('.p-modal', focusPane.el);
    if (m && !m.classList.contains('hidden')) { fecharModal(focusPane); return; }
    closePane(focusPane.id);
  }
  else if (a === 'pickFolder' && focusPane) $('.p-cwd', focusPane.el).click();
  else if (a === 'toggleSidebar') toggleSidebar();
  else if (a === 'clearPane') {
    // no terminal em foco, ⌘K e do terminal (como em qualquer terminal do Mac)
    const rT = termEmFoco();
    if (rT) { try { rT.term.clear(); } catch (_) {} return; }
    if (!focusPane) return;
    focusPane.chat.innerHTML = ''; focusPane.blocks.clear(); focusPane.tools.clear(); focusPane.rolagem = null;
    /* o note() so escreve na tela quando e ERRO: com ⌘K ele apagava tudo e nao punha nada no
       lugar — retangulo em branco, sem logo e sem uma palavra. Volta a tela de chat vazio que
       o app ja tem, e o recado vai por cima dela e some sozinho. */
    voltarVazio(focusPane);
    avisoTemp(focusPane, 'Tela limpa. A conversa continua de onde estava.');
  }
}

/* No TELEFONE nao existe menu de aplicativo (web.js deixa o onMenu vazio), entao nenhum destes
   atalhos existia la. Este bloco so vale quando NAO ha menu — no Mac ele fica desligado, senao
   cada tecla dispararia duas vezes (o menu e a pagina). ⌘W fica de fora de proposito: no
   navegador ele e da aba do browser e nao da para segurar. */
document.addEventListener('keydown', (e) => {
  if (!window.SEM_ELECTRON) return;
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = (e.key || '').toLowerCase();
  const mapa = e.shiftKey
    ? { t: 'newTab', w: 'reabrirFechado', d: 'ditar', f: 'foco' }
    : { t: 'newPane', o: 'pickFolder', k: 'clearPane', f: 'buscarNaConversa', d: 'perguntarAosDois', s: 'salvarVault', b: 'toggleSidebar' };
  if (!mapa[k]) return;
  e.preventDefault();
  acaoDeMenu(mapa[k]);
}, true);

/* ============ boot ============ */
(async function boot() {
  for (const engine of MOTORES) {
    const svg = document.getElementById('svg' + CAIXA_MOTOR[engine]);
    if (!svg) continue;
    svg.setAttribute('viewBox', LOGOS_MARCA[engine]?.viewBox || '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = conteudoLogoMotor(engine);
  }
  // R3-041: no iPhone estas 3 chamadas passam pelo WebSocket e podem demorar/rejeitar; sem
  // isto o boot inteiro travava mudo (a capa some sozinha em 12s e a tela fica vazia atrás).
  // Sem "return" no catch: HOME/cfg já nascem com padrão no topo do arquivo e o boot segue.
  try {
    HOME = await window.api.home();
    cfg = await window.api.getConfig();
    cfg.defCwd = cfg.defCwd || HOME;
    pintarCaminho($('#defCwd'), cfg.defCwd);
    $('#chkRobos').checked = !!cfg.verRobos;
    if ($('#chkAtalhosGlobais')) {
      $('#chkAtalhosGlobais').checked = !!cfg.atalhosGlobais;
      // se a tecla estiver tomada por outro programa, ele tem de saber ao abrir os Ajustes
      if (window.api.atalhosEstado) { try { pintarAvisoAtalhos(await window.api.atalhosEstado()); } catch (_) {} }
    }
    /* leva 6 — onde fica a caixa de entrada. O caminho MUDA entre rodar por `npm start` (pasta
       "cockpit") e o app instalado ("Cockpit"), então nenhum script pode cravá-lo: é daqui que
       se copia. No telefone a pasta é do Mac e não há o que abrir, então o bloco some. */
    if ($('#inboxBloco')) {
      if (window.SEM_ELECTRON) $('#inboxBloco').classList.add('hidden');
      else {
        try {
          const pasta = await window.api.inboxPasta();
          pintarCaminho($('#inboxPasta'), pasta);
          $('#btnInboxAbrir').addEventListener('click', () => { if (pasta) window.api.openPath(pasta); });
        } catch (_) {}
      }
    }
    if (window.api.webEstado) { const st = await window.api.webEstado(); if ($('#chkWeb')) $('#chkWeb').checked = !!(st && st.ligado); pintarWeb(st); }
  } catch (e) {
    console.error('boot: nao consegui falar com o Mac:', e);
    setTimeout(() => alert('Não consegui falar com o Mac. Recarregue a página.'), 300);
  }
  // no telefone: a lateral vira gaveta
  const bg = $('#btnGaveta');
  if (bg) {
    // no telefone a gaveta so serve com a lista de conversas junto
    let vistaTelefone = null;   // a ultima aba que ele escolheu no celular
    document.querySelectorAll('.act').forEach(a => a.addEventListener('click', () => { vistaTelefone = a.dataset.view; }));
    const abrirLista = () => {
      // no celular ele abre a gaveta para trocar de conversa, entao ja mostro as conversas
      // 25/09: a vista de conversas é uma só para todas as IAs
      const alvo = vistaTelefone || 'conversas';
      const b = document.querySelector('.act[data-view="' + alvo + '"]') || document.querySelector('.act[data-view="conversas"]');
      if (!b) return;
      const v = b.dataset.view;
      document.querySelectorAll('.act').forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll('.side-view').forEach(x => x.classList.toggle('hidden', x.dataset.view !== v));
      $('#sidebar').classList.remove('hidden');
      abrirVistaLateral(v);
    };
    bg.addEventListener('click', () => {
      const abriu = !document.body.classList.contains('gaveta');
      document.body.classList.toggle('gaveta', abriu);
      if (abriu) abrirLista();
    });
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('gaveta')) return;
      if (e.target.closest('#sidebar') || e.target.closest('#activitybar') || e.target.closest('#btnGaveta')) return;
      document.body.classList.remove('gaveta');
    });
    $$('.hist-item, .new-chat').forEach(() => {});
  }
  aplicarTema(cfg.tema);
  document.body.classList.toggle('foco', !!cfg.foco);   // o modo foco continua como ele deixou
  $('#verLine').textContent = '1.1.0';   // a linha dos Ajustes já se chama "Versão"
  repintarAvatares();
  const noTelefone = !!window.SEM_ELECTRON;
  // leva 12.5: o radar de motores instalados, sem segurar o boot e sem derrubar nada se falhar
  if (window.api.motoresDisponiveis) window.api.motoresDisponiveis().then(m => {
    MOTORES_OK = m || null;
    /* O radar responde DEPOIS que os painéis e a tela "Nova aba" já foram pintados. Sem este
       repinte, o motor que não existe nesta máquina continuaria com a cara dos outros três
       até ele abrir outro chat. */
    for (const P of panes.values()) paintEngine(P);
    naPintar();
  }).catch(() => {});
  if (!noTelefone) window.api.codexModels().then(ms => {
    if (ms && ms.length) { MODELOS_CODEX = traduzCodex(ms); for (const P of panes.values()) if (P.engine === 'codex') fillModels(P); }
  });
  // icones da tela de conversa nova
  for (const eng of MOTORES_VISIVEIS) $('#naIc' + CAIXA_MOTOR[eng]).innerHTML = svgMotor(eng);
  $('#naDoisA').innerHTML = svgMotor('claude');
  $('#naDoisB').innerHTML = svgMotor('codex');
  // pasta fechada, como no desenho (a aberta é a do visor de arquivo)
  $('.na-pasta-ic').innerHTML = ico('folder');
  $('#naPastaX').innerHTML = ico('x');
  // barra de icones aparece, a lateral comeca fechada
  $('#sidebar').classList.add('hidden'); $('#dragbar').classList.add('hidden');
  sincronizarIconesLaterais();
  /* 25/09: a costura das conversas (troca de IA no meio) antes das abas voltarem: e ela que
     diz quais partes cada chat traz de volta. Falhou? As abas voltam do jeito de antes. */
  try { await lerLigacoes(); } catch {}
  // volta com as abas e os chats de antes; so se nao houver nada e que pergunta o que abrir
  let voltou = false;
  try { voltou = await restaurarAbas(); }
  catch (e) {
    // as abas sumirem sem explicacao e o pior dos mundos: melhor dizer o que houve
    voltou = false;
    console.error('nao consegui restaurar as abas:', e);
    setTimeout(() => alert('Não consegui trazer suas abas de antes.\n\nMotivo: ' + ((e && e.message) || e) + '\n\nO trabalho não foi apagado: ele está em ~/Library/Application Support/cockpit/config.json'), 300);
  }
  if (!voltou) telaNovaAba(true);
  /* leva 10.4: o chip do git em TODOS os chats, não só no que está em foco — cada aba pode
     estar numa pasta diferente, e a branch de cada uma importa. */
  for (const Q of panes.values()) atualizarGit(Q);
  /* leva 6 — caixa de entrada. A ordem importa e é esta: primeiro registrar o ouvinte, só
     DEPOIS avisar o Mac que a tela já ouve. O `inbox:ouvindo` é quem levanta a bandeira lá; se
     ele fosse chamado antes, o main mandaria o aviso para uma tela que ainda não escuta, o
     arquivo ficaria marcado como visto e a mensagem se perderia para sempre.
     R2: guardado por `if`, porque no telefone estas duas são faz-de-conta. */
  if (window.api.onInbox) {
    window.api.onInbox((m) => chegouNaInbox(m));
    if (window.api.inboxOuvindo) {
      const avisarQueOuco = () => window.api.inboxOuvindo().catch(() => {});
      avisarQueOuco();
      /* E um SINAL DE VIDA, não um interruptor de uma vez só — e isso conserta um jeito de a
         caixa de entrada morrer calada. Do lado do Mac a bandeira cai a cada `did-start-loading`,
         e esse evento dispara também em navegação que o app CANCELA de propósito (o
         `will-navigate` do main devolve preventDefault em tudo — é o que impede a janela de
         "sumir" quando um arquivo é solto fora do campo de escrever). Medido aqui: depois de uma
         navegação cancelada a bandeira ficava em falso PARA SEMPRE e nenhum recado do celular
         aparecia mais, sem erro nenhum na tela. Quem sabe se esta tela está mesmo ouvindo é esta
         tela; então ela repete que está viva, e a bandeira se conserta sozinha em até 10s.
         Nada se perde no meio: com a bandeira em falso o Mac nem marca o arquivo como visto. */
      setInterval(avisarQueOuco, 10000);
    }
  }
  /* leva 10.6: radar de versão. Atrasado de propósito: a consulta ao npm leva segundos e o
     boot não pode esperar por ela. Se ainda não houver chat nenhum, ele mesmo se reagenda. */
  setTimeout(checarVersoesDosMotores, 12000);
  window.dispatchEvent(new Event('cockpit:pronto'));
})();
