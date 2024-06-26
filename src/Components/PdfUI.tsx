import * as PDFJS from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import Annotations from "../Scripts/Annotations";
import Toolbar from "./Toolbar";
import { DrawingStoredOptions, OptionUpdater } from "../Interfaces/CustomOptions";
import Thumbnail from "./GetThumbnail";
import { createRoot } from "react-dom/client";
import AlertTextDom from "./AlertTextDom";
import AlertManager from "../Scripts/AlertManager";
interface Props {
    pdfObj: PDFJS.PDFDocumentProxy
}
interface Ref {
    mainCanvas: HTMLCanvasElement | null, // The canvas where the PDF will be drawn
    centerDiv: HTMLDivElement | null, // The div that'll center the canvas on the card
    hoverCanvas: HTMLCanvasElement | null, // The canvas where all the events will be triggered
    toolbar: HTMLDivElement | null, // Unused
    circleCanvas: HTMLDivElement | null, // The div that'll represent the pointer. Called "canvas" since at the beginning it was another canvas
    thumbnailDiv: HTMLDivElement | null // The div that'll contain the thumbnail
}
interface MouseMove {
    target: HTMLCanvasElement,
    clientX: number,
    clientY: number
}
let isCanvasWorking = false; // If true, a PDF operation is in progress, and therefore further requests must be dropped
let zIndex = 2; // The initial zIndex for the canvas
let currentPdfShow = ""; // A string that'll contain details about the PDF page and zoom. This will be compared so that the app will know if it's time to re-render the canvas or not.
let userDrawingOptionsManager: DrawingStoredOptions = {
    timer: 15000,
    size: 5,
    cursorColor: getComputedStyle(document.body).getPropertyValue("--accent"),
    cursorSize: 40,
    penColor: getComputedStyle(document.body).getPropertyValue("--accent"),
    textSize: 25,
    textFont: "Work Sans",
    textLineSpace: 1.2,
    textStrikeLineWidth: 4,
    penOpacity: 1
}
let tempUserDrawingOptions = {
    isBold: false,
    isItalic: false,
    isUnderlined: false,
    isStriked: false,
    negativeFilter: 0,
    hueInversionFilter: 0,
    sepiaFilter: 0,
    grayscaleFilter: 0
}
try { // Update the persistent drawing options
    let parse = JSON.parse(localStorage.getItem("PDFPointer-UserAnnotationSettings") ?? "");
    // @ts-ignore
    for (let key in parse) if (userDrawingOptionsManager[key] !== undefined && typeof userDrawingOptionsManager[key] === typeof parse[key]) userDrawingOptionsManager[key] = parse[key]; // Keep only the key that are of the same type
} catch (ex) {
    console.warn({
        type: "FirstUser",
        desc: "No previous drawing options found",
        gravity: -1,
        ex: ex
    })
}
let customModes = {
    isEraserEnabled: false,
    isPenEnabled: false,
    isTextEnabled: false,
    isTextInCreation: false
}
function getTextAttributes() { // A function that will return the styles of the text tool, so that they must not be added each time.
    return { color: userDrawingOptionsManager.penColor, size: userDrawingOptionsManager.textSize, font: userDrawingOptionsManager.textFont, style: { lineSpacing: userDrawingOptionsManager.textLineSpace, ...tempUserDrawingOptions, lineHeight: userDrawingOptionsManager.textStrikeLineWidth } }
}
export default function PDF({ pdfObj }: Props) {
    let canvasRef = useRef<Ref>({ mainCanvas: null, centerDiv: null, hoverCanvas: null, toolbar: null, circleCanvas: null, thumbnailDiv: null });
    let [pageSettings, updatePage] = useState({ page: 1, scale: 1, showThumbnail: 0, isFullscreenChange: document.fullscreenElement, langUpdate: 0 });
    useEffect(() => {
        if (isCanvasWorking || currentPdfShow === `${pageSettings.page}-${pageSettings.scale}-${pageSettings.isFullscreenChange}`) return;
        // Create a spinner for loading info
        let div = document.createElement("div");
        createRoot(div).render(<div className="spinner" style={{ width: window.innerWidth > window.innerHeight ? "30vh" : "30vw", height: window.innerWidth > window.innerHeight ? "30vh" : "30vw" }}></div>)
        div.classList.add("simpleFixed", "simpleCenter");
        document.body.append(div);
        new Promise<void>(async (resolve) => {
            if (canvasRef.current !== undefined && canvasRef.current.centerDiv !== null) {
                isCanvasWorking = true; // Avoid multiple PDF operations
                let canvas = canvasRef.current.mainCanvas as unknown as HTMLCanvasElement;
                // Render the PDF
                let pdfPage = await pdfObj.getPage(pageSettings.page);
                let outputScale = window.devicePixelRatio || 1;
                let viewport = pdfPage.getViewport({ scale: pageSettings.isFullscreenChange ? window.innerHeight / pdfPage.getViewport({ scale: 1 }).height * pageSettings.scale : pageSettings.scale }); // If it's in fullscreen mode, the 100% zoom must fill the window height
                canvas.width = Math.floor(viewport.width * outputScale);
                canvas.height = Math.floor(viewport.height * outputScale);
                canvasRef.current.centerDiv.style.justifyContent = viewport.width > canvasRef.current.centerDiv.getBoundingClientRect().width ? "left" : "center"; // Make "justifyContent" left so that content isn't trimmed
                canvas.style.width = Math.floor(viewport.width) + "px";
                canvas.style.height = Math.floor(viewport.height) + "px";
                for (let annotation of Annotations.get({ page: 1, returnEverything: true })) annotation[0].style.display = annotation[1] === pageSettings.page ? "block" : "none"; // Show only the annotations of the page. Note that the "page" key will be ignored, and any value would be okay.
                for (let dom of document.querySelectorAll(".hoverCanvas")) { // Fix multiple canvas on top of another
                    let newCanvas = dom as SVGSVGElement;
                    newCanvas.style.transformOrigin = "top-left";
                    if (dom.getAttribute("data-noresize") === null) newCanvas.style.transform = `scale(${Math.floor(viewport.width) / parseInt(newCanvas.getAttribute("width") ?? "1")})`;
                    if (canvasRef.current.mainCanvas !== null) newCanvas.style.left = canvasRef.current.centerDiv.style.justifyContent === "center" ? `${(canvasRef.current.centerDiv.getBoundingClientRect().width - canvas.getBoundingClientRect().width) / 2}px` : "0px";
                }
                let context = canvas.getContext("2d");
                if (context !== null) {
                    let render = pdfPage.render({
                        canvasContext: context,
                        viewport: viewport,
                        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
                    });
                    await render.promise;
                    currentPdfShow = `${pageSettings.page}-${pageSettings.scale}-${pageSettings.isFullscreenChange}`;
                    isCanvasWorking = false;
                }
            }
            div.remove();
            resolve();
        })
        let fixCircleCanvas = setInterval(() => { // It actually should be immediately cleared. However, adapt the other canvases by setting them to the same width and height as the model
            let canvas = document.querySelector("canvas:not(.hoverCanvas)");
            if (canvas && canvasRef.current.hoverCanvas) {
                Annotations.adapt(canvasRef.current.hoverCanvas, (canvas as HTMLCanvasElement));
                clearInterval(fixCircleCanvas);
            }
        }, 25);

    }, [pageSettings.page, pageSettings.scale, pageSettings.isFullscreenChange]);
    useEffect(() => {
        window.addEventListener("resize", () => { 
            if (canvasRef.current.centerDiv && canvasRef.current.mainCanvas) {
                canvasRef.current.centerDiv.style.justifyContent = parseInt(canvasRef.current.mainCanvas.style.width.replace("px", "")) > canvasRef.current.centerDiv.getBoundingClientRect().width ? "left" : "center"; // Update the toolbar center so that no buttons are cut
                for (let item of canvasRef.current.centerDiv.querySelectorAll("canvas.hoverCanvas,svg")) { // Move the canvases (or annotations) so that they are always on top of another
                    (item as HTMLElement).style.left = `${canvasRef.current.centerDiv.style.justifyContent === "left" ? 0 : (canvasRef.current.centerDiv.getBoundingClientRect().width - canvasRef.current.mainCanvas.getBoundingClientRect().width) / 2}px`;
                }
            }
        });
        window.addEventListener("fullscreenchange", async (e) => { // Re-render the PDF with the new scaling options
            updatePage({ ...pageSettings, isFullscreenChange: document.fullscreenElement });
            window.dispatchEvent(new Event("resize"));
        })
    }, [])
    let mouseDown: boolean | [number, number] = false; // It'll contain the x and y position of the mouse
    let currentCanvas: HTMLOrSVGImageElement | undefined; 
    let item = document.querySelector(".backgroundContent");
    item && item.parentElement?.className !== "card" && document.querySelector(".card")?.append(item); // Move the background content to the "card" div if it's not already there, so that the background will be visible also in fullscreen mode (that is triggered only on the card div)
    function stopCanvasEditing() { // Stop mouse annotations, and start the erase timer
        mouseDown = false;
        if (currentCanvas !== undefined && !customModes.isEraserEnabled && !customModes.isTextEnabled) Annotations.end({ canvas: currentCanvas, disappear: userDrawingOptionsManager.timer })
    }
    useEffect((() => { 
        let getContainer = document.querySelector(".thumbnailContainer");
        if (pageSettings.showThumbnail === 2 && getContainer) { // If the "showThumbnail" value is set to 2, the thumbnail div must be hidden. An animation will be run, and after its value will be updated to 0 (not in the DOM).
            (getContainer as HTMLDivElement).classList.add("reverseLeftAnimation");
            new Promise((resolve) => setTimeout(() => resolve(""), 150)).then(() => updatePage({ ...pageSettings, showThumbnail: 0 }))
        }
    }), [pageSettings.showThumbnail])
    function createCanvas() { // Create a new SVG element (that was previously a canvas. I know, lots of things here needs to be renamed.)
        if (isCanvasWorking || customModes.isEraserEnabled) return;
        if (canvasRef.current.mainCanvas !== null) currentCanvas = Annotations.adapt(Annotations.create({ zIndex: zIndex, page: pageSettings.page }), canvasRef.current.mainCanvas) as HTMLOrSVGImageElement; // Create a new SVG element, and make it the same width/height as of the current canvas
        zIndex++;
        if (canvasRef.current.centerDiv !== null && currentCanvas !== undefined) canvasRef.current.centerDiv.append(currentCanvas);
    }
    function triggerTextChange() { // Send to the Annotation script a request to change the style of the text (that'll be automatically fetched)
        if (customModes.isTextInCreation && currentCanvas) Annotations.write({ canvas: currentCanvas, ...getTextAttributes() });
    }
    if (pageSettings.showThumbnail !== 0 && !document.fullscreenElement) { // Fixes for WebKit: append the container to the body, and then, when it must be deleted, append it to its previous place (the thumbnailDiv)
        let container = document.querySelector(".thumbnailContainer");
        if (container && canvasRef.current.thumbnailDiv) pageSettings.showThumbnail !== 2 ? document.body.append(container) : canvasRef.current.thumbnailDiv.append(container);
    }
    function mouseMove(e: MouseMove) { // As a function so that it can be called also for touch events
        let target = e.target as HTMLCanvasElement;
        mouseDown = [(e.clientX - (currentCanvas ?? target).getBoundingClientRect().left) * (window.devicePixelRatio || 1), (e.clientY - (currentCanvas ?? target).getBoundingClientRect().top) * (window.devicePixelRatio || 1)]; // Calculate the relative X and Y positions 
        let targetDown = [(e.clientX - target.getBoundingClientRect().left) * (window.devicePixelRatio || 1), (e.clientY - target.getBoundingClientRect().top) * (window.devicePixelRatio || 1)]; // Used for the eraser
        if (canvasRef.current.circleCanvas) { // Move the circle div
            canvasRef.current.circleCanvas.style.top = `${e.clientY - (userDrawingOptionsManager.cursorSize / 2)}px`;
            canvasRef.current.circleCanvas.style.left = `${e.clientX - (userDrawingOptionsManager.cursorSize / 2)}px`;
        }
        if (customModes.isEraserEnabled && mouseDown) { // Look for items to delete
            for (let svg of document.querySelectorAll(".hoverCanvas:not([data-noresize])")) {
                // Basically, the data-x and data-y attributes are calculated by [real canvas width or height / 10]. In this way, it does not require real precision
                if (svg.querySelector(`[data-x='${Math.floor(targetDown[0] / (window.devicePixelRatio || 1) / 10 * (parseInt(svg.getAttribute("width") ?? "1") / parseInt(canvasRef.current.mainCanvas?.style.width.replace("px", "") ?? "1")))}']`) !== null && svg.querySelector(`[data-y='${Math.floor(targetDown[1] / (window.devicePixelRatio || 1) / 10 * (parseInt(svg.getAttribute("width") ?? "1") / parseInt(canvasRef.current.mainCanvas?.style.width.replace("px", "") ?? "1")))}']`) !== null) {
                    if (svg.getAttribute("data-delete") === null) svg.setAttribute("data-delete", "a"); else continue; // Set the item state as deleted
                    (svg as HTMLElement).style.opacity = "0";
                    setTimeout(() => {
                        svg.remove();
                    }, 250);
                }
            }
            return;
        }
        if (!mouseDown || currentCanvas === undefined || !customModes.isPenEnabled || customModes.isTextEnabled) return; // No appropriate operations are being done
        Annotations.move({ canvas: currentCanvas, move: mouseDown, size: userDrawingOptionsManager.size, color: userDrawingOptionsManager.penColor, opacity: userDrawingOptionsManager.penOpacity });

    }
    function onMouseDown() {
        mouseDown = true;
        if (!customModes.isTextEnabled) createCanvas(); else if (!customModes.isTextInCreation) { // If another text is not being created, create a new one
            customModes.isTextInCreation = true;
            AlertManager.simpleDelete().then(() => { // Delete other alerts
                createCanvas();
                // Render the AlertTextDom
                let createText = document.createElement("div");
                createText.classList.add("alert");
                createRoot(createText).render(<AlertTextDom stop={() => {
                    if (currentCanvas) {
                        Annotations.write({ canvas: currentCanvas, final: true, ...getTextAttributes() });
                        if (currentCanvas) Annotations.end({ canvas: currentCanvas, disappear: userDrawingOptionsManager.timer });
                        customModes.isTextInCreation = false;
                    }
                    AlertManager.simpleDelete();
                }} remove={() => {
                    if (currentCanvas) Annotations.end({ canvas: currentCanvas, disappear: 1 });
                    AlertManager.simpleDelete();
                    customModes.isTextInCreation = false;

                }} update={(e) => { if (currentCanvas) Annotations.write({ canvas: currentCanvas, text: e, ...getTextAttributes() }) }}></AlertTextDom>);
                setTimeout(() => createText.style.opacity = "1", 25);
                (document.querySelector(".card") ?? document.body).append(createText); // Prefer adding it in the main card so that alerts are shown also on full screen mode (that is called on the .card item)
            })
        }
    }
    return <>
        <Toolbar pdfObj={pdfObj} pageSettings={pageSettings} updatePage={updatePage} canvasAdaptWhenClicked={() => { if (canvasRef.current.hoverCanvas !== null && canvasRef.current.mainCanvas !== null) Annotations.adapt(canvasRef.current.hoverCanvas, canvasRef.current.mainCanvas) }} settingsCallback={(e: OptionUpdater) => {
            /*
                The following map includes all the events that will update user values. 
                    - "isUtils" means that the "customModes" object will updated;
                    - "isTemp" means that the "tempUserDrawingOptions" will be updated. "trigger"
                    - "ref" is the property to update
                    - "triggerText" asks for the re-render of the current text
                    - "filter" indicates that the canvas filter must be updated
            */
            let updateMap = new Map([
                ["CustomSelectSize", { ref: "size", triggerText: true }],
                ["CustomTextSize", { ref: "textSize", triggerText: true }],
                ["CustomCursorColorSelect", { ref: "cursorColor" }],
                ["CustomCursorSize", { ref: "cursorSize" }],
                ["CustomPenColorSelect", { ref: "penColor", triggerText: true }],
                ["EraserChanged", { ref: "isEraserEnabled", isUtils: true }],
                ["ChangedPenStatus", { ref: "isPenEnabled", isUtils: true }],
                ["TextFontUpdater", { ref: "textFont", triggerText: true }],
                ["TextBoldChanged", { ref: "isBold", triggerText: true, isTemp: true }],
                ["TextLineSpaceChanged", { ref: "textLineSpace", triggerText: true }],
                ["TextItalicChanged", { ref: "isItalic", triggerText: true, isTemp: true }],
                ["TextUnderlineChanged", { ref: "isUnderlined", triggerText: true, isTemp: true }],
                ["TextStrikeChanged", { ref: "isStriked", triggerText: true, isTemp: true }],
                ["TextStrikeLineChange", { ref: "textStrikeLineWidth", triggerText: true }],
                ["ChangePenOpacity", { ref: "penOpacity" }],
                ["NegativeFilter", { ref: "negativeFilter", isTemp: true, filter: true }],
                ["HueInversionFilter", { ref: "hueInversionFilter", isTemp: true, filter: true }],
                ["SepiaFilter", { ref: "sepiaFilter", isTemp: true, filter: true }],
                ["GrayscaleFilter", { ref: "grayscaleFilter", isTemp: true, filter: true }]
            ])
            switch (e.interface) {
                case "CustomSelectTimer": // Update the timer length, by converting it in seconds
                    userDrawingOptionsManager.timer = (isNaN(+e.value) ? 150 : +e.value) * 1000;
                    break;
                case "ChangedTextStatus": // The user has entered or exited in the text mode. Update the values of some properties to their default ones to avoid UI issues
                    customModes.isTextEnabled = !customModes.isTextEnabled;
                    // @ts-ignore
                    for (let item of ["isBold", "isItalic", "isUnderlined", "isStriked"]) tempUserDrawingOptions[item] = false;
                    triggerTextChange();
                    break;
                default:
                    let updateItem = updateMap.get(e.interface);
                    function getValue({ source, value }: { source: string | boolean | number, value: string }) { // Convert value to the same type of the output
                        if (typeof source === "boolean") return !source;
                        if (typeof source === "number") return +value;
                        return value;
                    }
                    if (updateItem) {
                        // @ts-ignore | Update each object with the correct value, and save them in their appropriate storage
                        updateItem.isUtils ? customModes[updateItem.ref] = getValue({ source: customModes[updateItem.ref], value: e.value }) : updateItem.isTemp ? tempUserDrawingOptions[updateItem.ref] = getValue({ source: tempUserDrawingOptions[updateItem.ref], value: e.value }) : userDrawingOptionsManager[updateItem.ref] = getValue({ source: userDrawingOptionsManager[updateItem.ref], value: e.value });
                        updateItem.triggerText && triggerTextChange();
                        localStorage.setItem("PDFPointer-UserAnnotationSettings", JSON.stringify(userDrawingOptionsManager));
                        sessionStorage.setItem("PDFPointer-UserTempSettings", JSON.stringify(tempUserDrawingOptions)) // Note that this is only used to recover the PDF filters value. Temp values are never restored.
                        if (updateItem.filter && canvasRef.current.mainCanvas) canvasRef.current.mainCanvas.style.filter = `invert(${tempUserDrawingOptions.negativeFilter}) hue-rotate(${tempUserDrawingOptions.hueInversionFilter}deg) sepia(${tempUserDrawingOptions.sepiaFilter}) grayscale(${tempUserDrawingOptions.grayscaleFilter})`; // Update the canvas filters
                    }
                    break;
            }
            localStorage.setItem("PDFPointer-UserAnnotationSettings", JSON.stringify(userDrawingOptionsManager));
        }}></Toolbar>
        <br></br>
        <div style={{ overflow: "auto" }}>
            <div className="center" ref={el => (canvasRef.current.centerDiv = el)} style={{ overflow: "auto hidden" }}>
                <canvas key="PDFCanvas" ref={el => (canvasRef.current.mainCanvas = el)}></canvas>
                <div className="cursor" data-noresize key={"PDFCanvasCircle"} ref={el => (canvasRef.current.circleCanvas = el)}></div>
                <canvas style={{ zIndex: 999990, cursor: "none" }} key="PDFCanvasEvents" className="hoverCanvas" ref={el => (canvasRef.current.hoverCanvas = el)} data-noresize onMouseDown={(e) => onMouseDown()} onTouchStart={() => {
                    // Disable (or enable) standard touch actions so that, when the user is using a pen/eraser, the canvas won't move
                    if (canvasRef.current.centerDiv?.parentElement) canvasRef.current.centerDiv.parentElement.style.touchAction = customModes.isPenEnabled || customModes.isEraserEnabled ? "none" : "";
                    if (canvasRef.current.centerDiv) canvasRef.current.centerDiv.style.touchAction = customModes.isPenEnabled || customModes.isEraserEnabled ? "none" : "";
                    onMouseDown()
                }
                } onMouseMove={(e) => mouseMove({
                    target: e.target as HTMLCanvasElement,
                    clientX: e.clientX,
                    clientY: e.clientY
                })} onTouchMove={(e) => {
                    mouseMove({
                        target: e.target as HTMLCanvasElement,
                        clientX: e.touches[0].clientX,
                        clientY: e.touches[0].clientY
                    })
                }}
                    onClick={(e) => {
                        let target = e.target as HTMLCanvasElement;
                        if (customModes.isTextEnabled && currentCanvas) { // Update the position of the text
                            mouseDown = [(e.clientX - (currentCanvas ?? target).getBoundingClientRect().left) * (window.devicePixelRatio || 1), (e.clientY - (currentCanvas ?? target).getBoundingClientRect().top) * (window.devicePixelRatio || 1)];
                            Annotations.write({ canvas: currentCanvas, position: mouseDown, ...getTextAttributes() });
                        }
                    }}
                    onMouseUp={stopCanvasEditing} onTouchEnd={stopCanvasEditing} onMouseLeave={() => { stopCanvasEditing(); if (canvasRef.current.circleCanvas) canvasRef.current.circleCanvas.style.display = "none" }} onMouseEnter={() => {
                        if (canvasRef.current.circleCanvas) { // Update properties of the pointer circlee
                            canvasRef.current.circleCanvas.style.display = "block";
                            canvasRef.current.circleCanvas.style.backgroundColor = userDrawingOptionsManager.cursorColor;
                            for (let item of ["width", "height"]) canvasRef.current.circleCanvas.style[item as "width" | "height"] = `${userDrawingOptionsManager.cursorSize}px`;
                        }
                    }}></canvas>
            </div>
        </div >
        <div ref={el => (canvasRef.current.thumbnailDiv = el)}>
            {pageSettings.showThumbnail !== 0 && <Thumbnail PDFObj={pdfObj} pageListener={(e) => { updatePage({ ...pageSettings, page: e + 1 }) }}></Thumbnail>}
        </div>
    </>
}