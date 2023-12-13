import csTools, { toolColors, getToolState } from 'cornerstone-tools';
import cornerstone, {
    updateImage,
} from 'cornerstone-core';
import {loadHandlerManager} from "cornerstone-tools/src";
const BaseTool = csTools.importInternal('base/BaseTool');
const draw = csTools.importInternal('drawing/draw');
const drawCircle = csTools.importInternal('drawing/drawCircle');
const getNewContext = csTools.importInternal('drawing/getNewContext');
const setShadow = csTools.importInternal('drawing/setShadow');
const cursors = csTools.importInternal('tools/cursors');
const imagePointToPatientPoint = csTools.importInternal('util/imagePointToPatientPoint');
const projectPatientPointToImagePlane = csTools.importInternal('util/projectPatientPointToImagePlane');
const convertToVector3 = csTools.importInternal('util/convertToVector3');

/**
 * @public
 * @class SyncedProbeTool
 * @memberof Tools
 *
 * @classdesc Tool which provides a probe of the image data at the
 * input position on drag.
 * @extends Tools.Base.BaseTool
 */
export default class SyncedProbeTool extends BaseTool {
    constructor(props = {}) {
        const default_props = {
            name: 'SyncedProbeTool',
            strategies: {
                default: defaultStrategy
            },
            defaultStrategy: 'default',
            supportedInteractionTypes: ['Mouse', 'Touch'],
            mixins: ['activeOrDisabledBinaryTool'],
            svgCursor: cursors.crosshairsCursor,
        };

        super(props, default_props);

        this.touchDragCallback = this._movingEventCallback.bind(this);
        this.touchEndCallback = this._endMovingEventCallback.bind(this);

        this.mouseDragCallback = this._movingEventCallback.bind(this);
        this.mouseUpCallback = this._endMovingEventCallback.bind(this);

        this.dragEventData = {};
    }

    _movingEventCallback(evt) {
        this.dragEventData = evt.detail;
        cornerstone
            .getEnabledElements()
            .forEach(targetElement => {
                updateImage(targetElement.element);
            });
    }

    _endMovingEventCallback(evt) {
        this.dragEventData = {};
        cornerstone
            .getEnabledElements()
            .forEach(targetElement => {
                updateImage(targetElement.element);
            });
    }

    renderToolData(evt) {
        if (!this.dragEventData.currentPoints) {
            return;
        }

        if (
            evt &&
            evt.detail &&
            Boolean(Object.keys(this.dragEventData.currentPoints).length)
        ) {
            evt.detail.currentPoints = this.dragEventData.currentPoints;
            this.applyActiveStrategy(evt);
        }
    }
}

/**
 * Default strategy will pick the exactly point of mouse/touch interact and display the probe data.
 *
 * @param  {Object} evt Image rendered event
 * @returns {void}
 */
function defaultStrategy(evt) {
    const config = this.configuration;
    const eventData = evt.detail;
    const { element, image, currentPoints, canvasContext } = eventData;

    const context = getNewContext(canvasContext.canvas);

    const color = toolColors.getActiveColor();

    const x = Math.round(currentPoints.image.x);
    const y = Math.round(currentPoints.image.y);

    if (x < 0 || y < 0 || x >= image.columns || y >= image.rows) {
        return;
    }

    draw(context, context => {
        setShadow(context, config);
        const circCoords = {
            x: currentPoints.canvas.x,
            y: currentPoints.canvas.y,
        };

        drawCircle(context, element, circCoords, 2, { color }, 'canvas');
    });

    // Get current element target information
    const sourceEnabledElement = cornerstone.getEnabledElement(element);
    const sourceImageId = sourceEnabledElement.image.imageId;

    const sourceImagePlane = cornerstone.metaData.get('imagePlaneModule', sourceImageId);

    if (!sourceImagePlane)
    {
        console.warn(`Unable to retrieve imagePlaneModule for source image ${sourceImageId}`);
        return;
    }

    // Get the current point in the image space
    const sourceImagePoint = eventData.currentPoints.image;
    const patientPoint = imagePointToPatientPoint(sourceImagePoint, sourceImagePlane);

    cornerstone
        .getEnabledElements()
        .filter(e => e.uuid !== sourceEnabledElement.uuid)
        .forEach(targetElement => {
            const targetImage = targetElement.image;
            if (!targetImage) {
                console.debug(
                    'Could not render reference lines, one or more images not defined.'
                );
                return;
            }

            const stackToolDataSource = getToolState(targetElement.element, 'stack');
            if (stackToolDataSource === undefined) {
                console.warn(`No stack tool data source`);
                return;
            }

            const stackData = stackToolDataSource.data[0];
            let minDistance = Number.MAX_VALUE;
            let newImageIdx = -1;
            stackData.imageIds.forEach(function(imageId, index) {
                const imagePlane = cornerstone.metaData.get('imagePlaneModule', imageId);
                if (
                    !imagePlane ||
                    !imagePlane.imagePositionPatient ||
                    !imagePlane.rowCosines ||
                    !imagePlane.columnCosines
                ) {
                    return;
                }

                const imagePosition = convertToVector3(imagePlane.imagePositionPatient);
                const row = convertToVector3(imagePlane.rowCosines);
                const column = convertToVector3(imagePlane.columnCosines);
                const normal = column.clone().cross(row.clone())
                const distance = Math.abs(
                    normal.clone().dot(imagePosition) - normal.clone().dot(patientPoint)
                );

                if (distance < minDistance)
                {
                    minDistance = distance;
                    newImageIdx = index;
                }
            });

            if (newImageIdx > -1) {
                if (
                    //newImageIdx !== stackData.currentImageIdIndex &&
                    stackData.imageIds[newImageIdx] !== undefined) {
                    let startLoadHandler;
                    let endLoadHandler;
                    let errorLoadHandler;

                    //if (targetElement.element !== undefined) {
                    if (false) {
                        console.info('Using load handlers');
                        startLoadHandler = loadHandlerManager.getStartLoadHandler(targetElement.element);
                        endLoadHandler = loadHandlerManager.getEndLoadHandler(targetElement.element);
                        errorLoadHandler = loadHandlerManager.getEndLoadHandler(targetElement.element);
                    }

                    //console.info(`Loading image`);

                    if (startLoadHandler) {
                        startLoadHandler(targetElement.element);
                    }

                    let loader;
                    if (stackData.preventCache === true) {
                        loader = cornerstone.loadImage(stackData.imageIds[newImageIdx]);
                    } else {
                        loader = cornerstone.loadAndCacheImage(stackData.imageIds[newImageIdx]);
                    }

                    loader.then(
                        function (image) {
                            const viewPort = cornerstone.getViewport(targetElement.element);

                            stackData.currentImageIdIndex = newImageIdx;
                            cornerstone.displayImage(targetElement.element, image, viewPort);
                            if (endLoadHandler) {
                                endLoadHandler(targetElement.element);
                            }
                        },
                        function (error) {
                            const imageId = stackData.imageIds[newImageIdx];
                            if (errorLoadHandler)
                                errorLoadHandler(targetElement.element, imageId, error);
                        }
                    );
                }

                const imagePlane = cornerstone.metaData.get('imagePlaneModule', stackData.imageIds[newImageIdx]);
                const imPoint = projectPatientPointToImagePlane(patientPoint, imagePlane);
                const onReferenceElementImageRendered = () => {
                    const context = getNewContext(targetElement.canvas);
                    draw(context, newContext => {
                        setShadow(newContext, config);
                        drawCircle(newContext, targetElement.element, imPoint, 2, { color }, 'pixel');
                    });

                    targetElement.element.removeEventListener(
                        cornerstone.EVENTS.IMAGE_RENDERED,
                        onReferenceElementImageRendered
                    );
                };

                targetElement.element.addEventListener(
                    cornerstone.EVENTS.IMAGE_RENDERED,
                    onReferenceElementImageRendered
                );
            }
        });
}
