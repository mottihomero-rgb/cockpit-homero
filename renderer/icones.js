/* Ícones do redesenho (Claude Design, handoff de 25/09/2026).
   Estilo SF Symbols: grade de 16, traço de 1,4, pontas redondas, sempre em currentColor — a cor
   vem do CSS de quem usa, nunca daqui. Um lugar só para o app inteiro: o app.js (ico), o quadro.js
   (qico) e os SVGs fixos do index.html/index-web.html usam os traços deste mapa.

   Os traços da primeira parte são os do icons.svg/cockpit.js do handoff, copiados SEM mudança.
   A segunda parte ("desenhados aqui") são ícones que o app usa e o handoff não trazia; foram
   desenhados na mesma grade e no mesmo traço para não destoarem.
   Os logos provisórios do handoff (logo-claude etc.) ficaram de fora DE PROPÓSITO: os logos dos
   assistentes continuam os oficiais do svgMotor, só recoloridos com --logo-*.

   Por que inline e não <use href="icons.svg#i-plus">: no Mac a página abre por file:// e no
   iPhone vem pelo servidor do Mac; <use> apontando para arquivo externo falha nos dois casos
   (e não herda currentColor de forma confiável). Por isso o desenho entra dentro de cada <svg>.

   O <svg> não leva width/height: o tamanho é do CSS (README: 12 em texto de 11–12, 14 em botão
   pequeno, 16 na caixa de escrever, 18 na barra de ícones). */
(function (raiz) {
  var CK = {
    "plus": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><path d=\"M8 3v10M3 8h10\"></path></g>",
    "minus": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><path d=\"M3 8h10\"></path></g>",
    "xmark": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><path d=\"M4.5 4.5l7 7M11.5 4.5l-7 7\"></path></g>",
    "slash": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><path d=\"M10.5 2.5l-5 11\"></path></g>",
    "mic": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><rect x=\"5.75\" y=\"1.75\" width=\"4.5\" height=\"8\" rx=\"2.25\"></rect><path d=\"M3.5 7.75a4.5 4.5 0 0 0 9 0M8 12.25v2\"></path></g>",
    "queue": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 4.5h11M2.5 8h11M2.5 11.5h5.5M10.5 10l2.5 1.5-2.5 1.5z\"></path></g>",
    "plan": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 4.5l1.2 1.2L6 3.4M2.5 10.5l1.2 1.2L6 9.4M8.5 4.5h5M8.5 10.5h5\"></path></g>",
    "folder": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><path d=\"M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z\"></path></g>",
    "board": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"2.5\" width=\"12\" height=\"9\" rx=\"1.5\"></rect><path d=\"M5.5 14h5M5 8.5l2-2 1.5 1.5 2.5-2.5\"></path></g>",
    "team": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"><circle cx=\"8\" cy=\"5\" r=\"2\"></circle><circle cx=\"3.5\" cy=\"6.5\" r=\"1.4\"></circle><circle cx=\"12.5\" cy=\"6.5\" r=\"1.4\"></circle><path d=\"M4.8 13c.3-2 1.5-3.2 3.2-3.2s2.9 1.2 3.2 3.2M1.5 12c.2-1.2.9-2 2-2.1M14.5 12c-.2-1.2-.9-2-2-2.1\"></path></g>",
    "lock-open": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><rect x=\"3.5\" y=\"7\" width=\"9\" height=\"6.5\" rx=\"1.5\"></rect><path d=\"M5.5 7V5a2.5 2.5 0 0 1 4.8-1\"></path></g>",
    "lock": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><rect x=\"3.5\" y=\"7\" width=\"9\" height=\"6.5\" rx=\"1.5\"></rect><path d=\"M5.5 7V5a2.5 2.5 0 0 1 5 0v2\"></path></g>",
    "stop": "<rect x=\"4.5\" y=\"4.5\" width=\"7\" height=\"7\" rx=\"1.5\" fill=\"currentColor\"></rect>",
    "arrow-up": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.7\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 12.5v-9M4.5 7L8 3.5 11.5 7\"></path></g>",
    "chevron-down": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4.5 6.25L8 9.75l3.5-3.5\"></path></g>",
    "chevron-right": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6.25 4.5L9.75 8l-3.5 3.5\"></path></g>",
    "chevron-up": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4.5 9.75L8 6.25l3.5 3.5\"></path></g>",
    "updown": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5.5 6L8 3.5 10.5 6M5.5 10L8 12.5 10.5 10\"></path></g>",
    "pencil": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><path d=\"M10.5 2.75l2.75 2.75L6 12.75l-3.25.5.5-3.25z\"></path></g>",
    "copy": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><rect x=\"5.5\" y=\"5.5\" width=\"8\" height=\"8\" rx=\"1.5\"></rect><path d=\"M10.5 3.5V3a1 1 0 0 0-1-1h-6A1.5 1.5 0 0 0 2 3.5v6a1 1 0 0 0 1 1h.5\"></path></g>",
    "rewind": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 5.5h6.5a3.5 3.5 0 0 1 0 7H6M5.5 3L3 5.5 5.5 8\"></path></g>",
    "search": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><circle cx=\"7\" cy=\"7\" r=\"4.5\"></circle><path d=\"M10.4 10.4l3.1 3.1\"></path></g>",
    "tower": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><circle cx=\"8\" cy=\"8\" r=\"1.3\" fill=\"currentColor\" stroke=\"none\"></circle><path d=\"M5.3 5.3a3.8 3.8 0 0 0 0 5.4M10.7 5.3a3.8 3.8 0 0 1 0 5.4M3.2 3.2a6.8 6.8 0 0 0 0 9.6M12.8 3.2a6.8 6.8 0 0 1 0 9.6\"></path></g>",
    "clock": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><circle cx=\"8\" cy=\"8\" r=\"6\"></circle><path d=\"M8 4.75V8l2.25 1.5\"></path></g>",
    "sliders": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><path d=\"M2.5 5h5.5M12 5h1.5M2.5 11h1.5M8 11h5.5\"></path><circle cx=\"10\" cy=\"5\" r=\"1.75\"></circle><circle cx=\"6\" cy=\"11\" r=\"1.75\"></circle></g>",
    "branch": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"><circle cx=\"5\" cy=\"3.5\" r=\"1.5\"></circle><circle cx=\"5\" cy=\"12.5\" r=\"1.5\"></circle><circle cx=\"11\" cy=\"5\" r=\"1.5\"></circle><path d=\"M5 5v6M11 6.5c0 2.5-6 1.5-6 4.5\"></path></g>",
    "check": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3.5 8.5l3 3 6-7\"></path></g>",
    "info": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"><circle cx=\"8\" cy=\"8\" r=\"6\"></circle><path d=\"M8 7.25v4\"></path><circle cx=\"8\" cy=\"5\" r=\".8\" fill=\"currentColor\" stroke=\"none\"></circle></g>",
    "chat": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><path d=\"M4 3h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 11H6.5l-3 2.5v-2.7a1.5 1.5 0 0 1-1-1.3v-5A1.5 1.5 0 0 1 4 3z\"></path></g>",
    "tray": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><path d=\"M2 9.5l1.8-5.2a1 1 0 0 1 .9-.8h6.6a1 1 0 0 1 .9.8L14 9.5v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zM2 9.5h3.5l1 1.5h3l1-1.5H14\"></path></g>",
    "external": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 2.75h4.25V7M13.25 2.75L7.5 8.5M11 9.5v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3\"></path></g>",
    "doc": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><path d=\"M4 1.75h5l3 3v8.75a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75V2.5a.75.75 0 0 1 .75-.75zM9 1.75v3h3\"></path></g>",
    "terminal": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"2.75\" width=\"12\" height=\"10.5\" rx=\"1.75\"></rect><path d=\"M5 6.5l2 1.75-2 1.75M8.5 10.25h2.75\"></path></g>",
    "sidebar": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"><rect x=\"2\" y=\"2.75\" width=\"12\" height=\"10.5\" rx=\"1.75\"></rect><path d=\"M6.25 2.75v10.5\"></path></g>",
    "warn": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"><path d=\"M8 2.5l6 10.5H2z\"></path><path d=\"M8 6.5v3\"></path><circle cx=\"8\" cy=\"11.2\" r=\".75\" fill=\"currentColor\" stroke=\"none\"></circle></g>",
    "ellipsis": "<g fill=\"currentColor\"><circle cx=\"3.5\" cy=\"8\" r=\"1.1\"></circle><circle cx=\"8\" cy=\"8\" r=\"1.1\"></circle><circle cx=\"12.5\" cy=\"8\" r=\"1.1\"></circle></g>",
    "photo": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><rect x=\"2\" y=\"2.75\" width=\"12\" height=\"10.5\" rx=\"1.75\"></rect><circle cx=\"5.75\" cy=\"6.25\" r=\"1.1\"></circle><path d=\"M2.5 11.5L6 8l2.5 2.5 2-2 3 3\"></path></g>",
    "retry": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3\"></path></g>",
    "play": "<path d=\"M5 3.5v9l7.5-4.5z\" fill=\"currentColor\"></path>",
    "trash": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.75 4.5h10.5M6.25 4.5V2.75h3.5V4.5M4.25 4.5l.6 8.5a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.5\"></path></g>",
    "download": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10\"></path></g>",
    "pointer": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linejoin=\"round\"><path d=\"M4 2.5v10.25l2.8-2.6 1.8 3.8 1.7-.8-1.8-3.7h3.8z\"></path></g>",
    "move": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 2v12M2 8h12M6.25 3.75L8 2l1.75 1.75M6.25 12.25L8 14l1.75-1.75M3.75 6.25L2 8l1.75 1.75M12.25 6.25L14 8l-1.75 1.75\"></path></g>",
    "rect": "<rect x=\"2.5\" y=\"4\" width=\"11\" height=\"8\" rx=\"1\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"></rect>",
    "circle": "<circle cx=\"8\" cy=\"8\" r=\"5.5\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"></circle>",
    "diamond": "<path d=\"M8 2.25L13.75 8 8 13.75 2.25 8z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"></path>",
    "note": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linejoin=\"round\"><path d=\"M2.75 2.75h10.5v6.75L9.5 13.25H2.75zM9.5 13.25V9.5h3.75\"></path></g>",
    "text": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><path d=\"M3.5 4.25V3h9v1.25M8 3v10M6.5 13h3\"></path></g>",
    "arrow": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 13L13 3M7.5 3H13v5.5\"></path></g>",
    "line": "<path d=\"M3 13L13 3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"></path>",
    "scribble": "<path d=\"M2.5 11.5c2-3.5 3-5.5 4.5-5.5s.3 4.5 2 4.5 2.5-3.5 4.5-6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"></path>",
    "eraser": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9.5 2.75l3.75 3.75L7.5 12.25H4.75l-2-2zM6 6.25l3.75 3.75M7.5 13.25h6\"></path></g>",
    "person": "<g fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"><circle cx=\"8\" cy=\"5.5\" r=\"2.75\"></circle><path d=\"M2.75 14c.5-2.75 2.5-4.25 5.25-4.25s4.75 1.5 5.25 4.25\"></path></g>",
    /* ---- desenhados aqui, na mesma grade (o handoff não tinha) ---- */
    "arrows-lr": "<path d=\"M2.5 5.25h10.5M10.5 2.75l2.5 2.5-2.5 2.5M13.5 10.75H3M5.5 8.25l-2.5 2.5 2.5 2.5\"/>",
    "braces": "<path d=\"M5.75 2.5h-.5A1.5 1.5 0 0 0 3.75 4v2.25L2.5 8l1.25 1.75V12a1.5 1.5 0 0 0 1.5 1.5h.5M10.25 2.5h.5A1.5 1.5 0 0 1 12.25 4v2.25L13.5 8l-1.25 1.75V12a1.5 1.5 0 0 1-1.5 1.5h-.5\"/>",
    "brain": "<path d=\"M8 3.5v9.5M8 3.5a2 2 0 0 0-3.75-.9A2.25 2.25 0 0 0 2.6 6.4a2.4 2.4 0 0 0 .4 4.1 2.25 2.25 0 0 0 3.25 2.4A1.9 1.9 0 0 0 8 13M8 3.5a2 2 0 0 1 3.75-.9 2.25 2.25 0 0 1 1.65 3.8 2.4 2.4 0 0 1-.4 4.1 2.25 2.25 0 0 1-3.25 2.4A1.9 1.9 0 0 1 8 13\"/>",
    "code": "<path d=\"M5.25 4.5L1.75 8l3.5 3.5M10.75 4.5L14.25 8l-3.5 3.5M9.25 3l-2.5 10\"/>",
    "doc-code": "<path d=\"M4 1.75h5l3 3v8.75a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75V2.5a.75.75 0 0 1 .75-.75zM9 1.75v3h3M6.5 8l-1.5 1.5L6.5 11M9.5 8l1.5 1.5L9.5 11\"/>",
    "doc-text": "<path d=\"M4 1.75h5l3 3v8.75a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75V2.5a.75.75 0 0 1 .75-.75zM9 1.75v3h3M5.75 8.25h4.5M5.75 10.75h3\"/>",
    "folder-open": "<path d=\"M2 11.5v-7A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h4A1.5 1.5 0 0 1 13 6v1M2 11.5 3.7 7.8a1.25 1.25 0 0 1 1.15-.8h8.4a.75.75 0 0 1 .7 1.05l-1.6 3.9a1.75 1.75 0 0 1-1.6 1.05H3.5A1.5 1.5 0 0 1 2 11.5z\"/>",
    "key": "<circle cx=\"5.25\" cy=\"10.75\" r=\"2.75\"/><path d=\"M7.25 8.75L13 3M11 5l1.75 1.75M9.5 6.5l1.25 1.25\"/>",
    "log-out": "<path d=\"M6.25 2.75H4a1.25 1.25 0 0 0-1.25 1.25v8A1.25 1.25 0 0 0 4 13.25h2.25M10.5 5l3 3-3 3M13.5 8h-7\"/>",
    "pin": "<path d=\"M8 14.25s4.5-3.9 4.5-7.75a4.5 4.5 0 0 0-9 0c0 3.85 4.5 7.75 4.5 7.75z\"/><circle cx=\"8\" cy=\"6.5\" r=\"1.6\"/>",
    "plug": "<path d=\"M5.75 1.75V4.5M10.25 1.75V4.5M3.75 4.5h8.5v2.25a4.25 4.25 0 0 1-8.5 0zM8 11v3.25\"/>",
    "question": "<circle cx=\"8\" cy=\"8\" r=\"6\"/><path d=\"M6.3 6.4a1.8 1.8 0 0 1 3.45.6c0 1.2-1.75 1.45-1.75 2.45\"/><circle cx=\"8\" cy=\"11.3\" r=\".8\" fill=\"currentColor\" stroke=\"none\"/>",
    "server": "<rect x=\"2.25\" y=\"2.5\" width=\"11.5\" height=\"4.75\" rx=\"1.25\"/><rect x=\"2.25\" y=\"8.75\" width=\"11.5\" height=\"4.75\" rx=\"1.25\"/><circle cx=\"5\" cy=\"4.9\" r=\".8\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"5\" cy=\"11.1\" r=\".8\" fill=\"currentColor\" stroke=\"none\"/>",
    "sparkles": "<path d=\"M6.5 2l1.1 3.4L11 6.5 7.6 7.6 6.5 11 5.4 7.6 2 6.5l3.4-1.1zM12 9.5l.55 1.45L14 11.5l-1.45.55L12 13.5l-.55-1.45L10 11.5l1.45-.55z\"/>",
    "star": "<path d=\"M8 2.1l1.8 3.65 4.02.58-2.91 2.84.69 4.01L8 11.29l-3.6 1.89.69-4.01-2.91-2.84 4.02-.58z\"/>",
    "upload": "<path d=\"M8 10.5v-8M4.5 6L8 2.5 11.5 6M3 13.5h10\"/>",
    "bolt": "<path d=\"M9.25 1.75L3.5 9h4.25L6.75 14.25 12.5 7H8.25z\"/>",
    "columns": "<rect x=\"2\" y=\"2.75\" width=\"12\" height=\"10.5\" rx=\"1.75\"/><path d=\"M8 2.75v10.5\"/>",
    "book": "<path d=\"M8 4.25C6.5 3 4.5 2.6 2.25 2.75v9.5C4.5 12.1 6.5 12.5 8 13.75c1.5-1.25 3.5-1.65 5.75-1.5v-9.5C11.5 2.6 9.5 3 8 4.25zM8 4.25v9.5\"/>",
    "crop": "<path d=\"M4.5 1.75v8.5a1.25 1.25 0 0 0 1.25 1.25h8.5M1.75 4.5h8.5a1.25 1.25 0 0 1 1.25 1.25v8.5\"/>",
    "camera": "<path d=\"M2 5.5a1.25 1.25 0 0 1 1.25-1.25h1.8L6.3 2.5h3.4l1.25 1.75h1.8A1.25 1.25 0 0 1 14 5.5v6.25A1.25 1.25 0 0 1 12.75 13h-9.5A1.25 1.25 0 0 1 2 11.75z\"/><circle cx=\"8\" cy=\"8.5\" r=\"2.25\"/>",
    "redo": "<path d=\"M13 5.5H6.5a3.5 3.5 0 0 0 0 7H10M10.5 3L13 5.5 10.5 8\"/>",
    "fill": "<circle cx=\"8\" cy=\"8\" r=\"5.5\"/><path d=\"M8 2.5a5.5 5.5 0 0 0 0 11z\" fill=\"currentColor\" stroke=\"none\"/>",
    "bring-front": "<rect x=\"5.5\" y=\"5.5\" width=\"8.5\" height=\"8.5\" rx=\"1.5\"/><path d=\"M3.5 10.5h-.25A1.25 1.25 0 0 1 2 9.25v-6A1.25 1.25 0 0 1 3.25 2h6a1.25 1.25 0 0 1 1.25 1.25v.25\"/>",
    "send-back": "<rect x=\"2\" y=\"2\" width=\"8.5\" height=\"8.5\" rx=\"1.5\"/><path d=\"M12.5 5.5h.25A1.25 1.25 0 0 1 14 6.75v6A1.25 1.25 0 0 1 12.75 14h-6a1.25 1.25 0 0 1-1.25-1.25v-.25\"/>",
    "fit": "<path d=\"M2.5 6V3.75A1.25 1.25 0 0 1 3.75 2.5H6M10 2.5h2.25a1.25 1.25 0 0 1 1.25 1.25V6M13.5 10v2.25a1.25 1.25 0 0 1-1.25 1.25H10M6 13.5H3.75a1.25 1.25 0 0 1-1.25-1.25V10\"/>",
  };
  /* Os atributos do <svg> são o padrão dos desenhados aqui (traço 1,4, sem preenchimento). Os do
     handoff trazem os próprios atributos no <g> e ganham deles. O CSS ainda consegue mudar o
     preenchimento dos desenhados aqui (a estrela de favorita, por exemplo). */
  function ckIcone(nome, classe) {
    return '<svg viewBox="0 0 16 16" class="' + (classe || 'ic') + '" fill="none" stroke="currentColor" '
      + 'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (CK[nome] || '') + '</svg>';
  }
  raiz.CK_ICONES = CK;
  raiz.ckIcone = ckIcone;
})(typeof window !== 'undefined' ? window : globalThis);
