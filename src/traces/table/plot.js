/**
* Copyright 2012-2017, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/

'use strict';

var c = require('./constants');
var d3 = require('d3');
var gup = require('../../lib/gup');
var Drawing = require('../../components/drawing');
var extendFlat = require('../../lib/extend').extendFlat;
var svgUtil = require('../../lib/svg_text_utils');
var raiseToTop = require('../../lib').raiseToTop;
var cancelEeaseColumn = require('../../lib').cancelTransition;

module.exports = function plot(gd, calcdata) {

    if(c.clipView) {
        gd._fullLayout._paper.attr('height', 2000);
    }

    var table = gd._fullLayout._paper.selectAll('.table')
        .data(calcdata.map(gup.unwrap), gup.keyFun);

    table.exit().remove();

    table.enter()
        .append('g')
        .classed('table', true)
        .attr('overflow', 'visible')
        .style('box-sizing', 'content-box')
        .style('position', 'absolute')
        .style('left', 0)
        .style('overflow', 'visible')
        .style('shape-rendering', 'crispEdges')
        .style('pointer-events', 'all'); // todo restore 'none'

    table
        .attr('width', function(d) {return d.width + d.size.l + d.size.r;})
        .attr('height', function(d) {return d.height + d.size.t + d.size.b;})
        .attr('transform', function(d) {
            return 'translate(' + d.translateX + ',' + d.translateY + ')';
        });

    var tableControlView = table.selectAll('.tableControlView')
        .data(gup.repeat, gup.keyFun);

    tableControlView.enter()
        .append('g')
        .classed('tableControlView', true)
        .style('box-sizing', 'content-box')
        .on('mousemove', function() {tableControlView.call(renderScrollbarKit);})
        .on('mousewheel', function(d) {
            d3.event.preventDefault();
            makeDragRow(gd, tableControlView, null, d.scrollY + d3.event.deltaY)(d);
        })
        .call(renderScrollbarKit);

    tableControlView
        .attr('transform', function(d) {return 'translate(' + d.size.l + ' ' + d.size.t + ')';})

        if(!c.clipView) {
            tableControlView.attr('clip-path', function (d) {return 'url(#scrollAreaBottomClip_' + d.key + ')';});
        }

    var yColumn = tableControlView.selectAll('.yColumn')
        .data(function(vm) {return vm.columns;}, gup.keyFun);

    yColumn.enter()
        .append('g')
        .classed('yColumn', true);

    yColumn
        .attr('transform', function(d) {return 'translate(' + d.x + ' 0)';})
        .call(d3.behavior.drag()
            .origin(function(d) {
                var movedColumn = d3.select(this);
                easeColumn(movedColumn, d, -c.uplift);
                raiseToTop(this);
                d.calcdata.columnDragInProgress = true;
                renderScrollbarKit(tableControlView);
                return d;
            })
            .on('drag', function(d) {
                var movedColumn = d3.select(this);
                var getter = function(dd) {return  (d === dd ? d3.event.x : dd.x) + dd.columnWidth / 2;}
                d.x = Math.max(-c.overdrag, Math.min(d.calcdata.width + c.overdrag - d.columnWidth, d3.event.x));
                var newOrder = yColumn.data().sort(function(a, b) {return getter(a) - getter(b);});
                newOrder.forEach(function(dd, i) {
                    dd.xIndex = i;
                    dd.x = d === dd ? dd.x : dd.xScale(dd);
                })

                yColumn.filter(function(dd) {return d !== dd;})
                    .transition()
                    .ease(c.transitionEase)
                    .duration(c.transitionDuration)
                    .attr('transform', function(d) {return 'translate(' + d.x + ' 0)';});
                movedColumn
                    .call(cancelEeaseColumn)
                    .attr('transform', 'translate(' + d.x + ' -' + c.uplift + ' )');
            })
            .on('dragend', function(d) {
                var movedColumn = d3.select(this);
                var p = d.calcdata;
                d.x = d.xScale(d);
                d.calcdata.columnDragInProgress = false;
                easeColumn(movedColumn, d, 0);
                columnMoved(gd, calcdata, p.key, p.columns.map(function(dd) {return dd.xIndex;}));
            })
        );

    if(!c.clipView) {
        yColumn.attr('clip-path', function(d) {return 'url(#columnBoundaryClippath_' + d.specIndex + ')';});
    }

    yColumn.exit()
        .remove();

    var columnBlock = yColumn.selectAll('.columnBlock')
        .data(splitToPanels, gup.keyFun);

    columnBlock.enter()
        .append('g')
        .classed('columnBlock', true)
        .style('user-select', 'none');

    columnBlock
        .style('cursor', function(d) {return d.dragHandle ? 'ew-resize' : 'ns-resize';});

    var cellsColumnBlock = columnBlock.filter(cellsBlock);

    cellsColumnBlock
        .call(d3.behavior.drag()
            .origin(function(d) {
                d3.event.stopPropagation();
                return d;
            })
            .on('drag', makeDragRow(gd, tableControlView, -1))
            .on('dragend', function(d) {
                // fixme emit plotly notification
            })
        );

    // initial rendering: header is rendered first, as it may may have async LaTeX (show header first)
    // but blocks are _entered_ the way they are due to painter's algo (header on top)
    renderColumnBlocks(gd, tableControlView, columnBlock.filter(headerBlock), columnBlock);
    renderColumnBlocks(gd, tableControlView, columnBlock.filter(cellsBlock), columnBlock);

    var scrollAreaClip = tableControlView.selectAll('.scrollAreaClip')
        .data(gup.repeat, gup.keyFun);

    scrollAreaClip.enter()
        .append(c.clipView ? 'g' : 'clipPath')
        .classed('scrollAreaClip', true)
        .attr('id', function(d) { return 'scrollAreaBottomClip_' + d.key;});

    var scrollAreaClipRect = scrollAreaClip.selectAll('.scrollAreaClipRect')
        .data(gup.repeat, gup.keyFun);

    scrollAreaClipRect.enter()
        .append('rect')
        .classed('scrollAreaClipRect', true)
        .attr('x', -c.overdrag)
        .attr('y', -c.uplift)
        .attr('stroke', 'orange')
        .attr('stroke-width', 2)
        .attr('fill', 'none')
        .style('pointer-events', 'stroke');

    scrollAreaClipRect
        .attr('width', function(d) {return d.width + 2 * c.overdrag;})
        .attr('height', function(d) {return d.height + c.uplift;});

    var columnBoundary = yColumn.selectAll('.columnBoundary')
        .data(gup.repeat, gup.keyFun);

    columnBoundary.enter()
        .append('g')
        .classed('columnBoundary', true);

    var columnBoundaryClippath = yColumn.selectAll('.columnBoundaryClippath')
        .data(gup.repeat, gup.keyFun);

    // SVG spec doesn't mandate wrapping into a <defs> and doesn't seem to cause a speed difference
    columnBoundaryClippath.enter()
        .append(c.clipView ? 'g' : 'clipPath')
        .classed('columnBoundaryClippath', true);

    columnBoundaryClippath
        .attr('id', function(d) {return 'columnBoundaryClippath_' + d.specIndex;});

    var columnBoundaryRect = columnBoundaryClippath.selectAll('.columnBoundaryRect')
        .data(gup.repeat, gup.keyFun);

    columnBoundaryRect.enter()
        .append('rect')
        .classed('columnBoundaryRect', true)
        .attr('fill', 'none')
        .attr('stroke', 'magenta')
        .attr('stroke-width', 2)
        .style('pointer-events', 'stroke');

    columnBoundaryRect
        .attr('width', function(d) {return d.columnWidth;})
        .attr('height', function(d) {return d.calcdata.height + c.uplift;});
};

function renderScrollbarKit(tableControlView) {

    function calcTotalHeight(d) {
        var blocks = d.rowBlocks;
        return firstRowAnchor2(blocks, blocks.length) + rowsHeight(blocks[blocks.length - 1], Infinity);
    }

    var scrollbarKit = tableControlView.selectAll('.scrollbarKit')
        .data(gup.repeat, gup.keyFun);

    scrollbarKit.enter()
        .append('g')
        .classed('scrollbarKit', true)

    scrollbarKit
        .each(function(d) {
            var s = d.scrollbarState;
            s.totalHeight = calcTotalHeight(d);
            s.scrollableAreaHeight = d.groupHeight - headerHeight(d);
            s.currentlyVisibleHeight = Math.min(s.totalHeight, s.scrollableAreaHeight);
            s.ratio = s.currentlyVisibleHeight / s.totalHeight;
            s.barLength = s.ratio * s.currentlyVisibleHeight;
            s.barWiggleRoom = s.currentlyVisibleHeight - s.barLength;
            s.wiggleRoom = s.totalHeight - s.scrollableAreaHeight;
            s.topY = (d.scrollY / s.wiggleRoom) * s.barWiggleRoom;
            s.bottomY = s.topY + s.barLength;
            s.dragMultiplier = s.wiggleRoom / s.barWiggleRoom;
        })
        .attr('transform', function(d) {
            var xPosition = d.width + c.scrollbarWidth / 2 + c.scrollbarOffset;
            return 'translate(' + xPosition + ' ' + headerHeight(d) + ')';
        });

    var scrollbar = scrollbarKit.selectAll('.scrollbar')
        .data(gup.repeat, gup.keyFun);

    scrollbar.enter()
        .append('g')
        .classed('scrollbar', true);

    var scrollbarSlider = scrollbar.selectAll('.scrollbarSlider')
        .data(gup.repeat, gup.keyFun);

    scrollbarSlider.enter()
        .append('g')
        .classed('scrollbarSlider', true);

    scrollbarSlider
        .attr('transform', function(d) {
            return 'translate(0 ' + d.scrollbarState.topY + ')';
        });

    var scrollbarGlyph = scrollbarSlider.selectAll('.scrollbarGlyph')
        .data(gup.repeat, gup.keyFun);

    scrollbarGlyph.enter()
        .append('line')
        .classed('scrollbarGlyph', true)
        .attr('stroke', 'black')
        .attr('stroke-width', c.scrollbarWidth)
        .attr('stroke-linecap', 'round')
        .attr('y1', c.scrollbarWidth / 2);

    scrollbarGlyph
        .attr('y2', function(d) {
            return d.scrollbarState.barLength - c.scrollbarWidth / 2;
        })
        .attr('stroke-opacity', function(d) {return d.columnDragInProgress ? 0 : 0.4});

    // cancel transition: possible pending (also, delayed) transition
    scrollbarGlyph
        .transition().delay(0).duration(0);

    scrollbarGlyph
        .transition().delay(c.scrollbarHideDelay).duration(c.scrollbarHideDuration)
        .attr('stroke-opacity', 0);

    var scrollbarCaptureZone = scrollbar.selectAll('.scrollbarCaptureZone')
        .data(gup.repeat, gup.keyFun);

    scrollbarCaptureZone.enter()
        .append('line')
        .classed('scrollbarCaptureZone', true)
        .attr('stroke', 'red')
        .attr('stroke-width', c.scrollbarCaptureWidth)
        .attr('stroke-linecap', 'butt')
        .attr('stroke-opacity', c.clipView ? 0.5 : 0)
        .attr('y1', 0)
        .on('mousedown', function(d) {
            var y = d3.event.y;
            var bbox = this.getBoundingClientRect();
            var s = d.scrollbarState;
            var pixelVal = y - bbox.top;
            var inverseScale = d3.scale.linear().domain([0, s.scrollableAreaHeight]).range([0, s.totalHeight]).clamp(true);
            if(s.topY <= pixelVal && pixelVal <= s.bottomY) {
                //console.log('on glyph!')
            } else {
                makeDragRow(gd, tableControlView, null, inverseScale(pixelVal - s.barLength / 2))(d);
            }
            //console.log('mousedown', bbox.top, bbox.bottom, y, scale(y))
        })
        .call(d3.behavior.drag()
            .origin(function(d) {
                //console.log('drag started')
                d3.event.stopPropagation();
                d.scrollbarState.scrollbarScrollInProgress = true;
                return d;
            })
            .on('drag', makeDragRow(gd, tableControlView))
            .on('dragend', function(d) {
                //console.log('drag ended')
                // fixme emit Plotly event
            })
        );

    scrollbarCaptureZone
        .attr('y2', function(d) {
            return d.scrollbarState.scrollableAreaHeight;
        });
}

function renderColumnBlocks(gd, tableControlView, columnBlock, allColumnBlock) {
    // this is performance critical code as scrolling calls it on every revolver switch
    // it appears sufficiently fast but there are plenty of low-hanging fruits for performance optimization

    var columnCells = columnBlock.selectAll('.columnCells')
        .data(gup.repeat, gup.keyFun);

    columnCells.enter()
        .append('g')
        .classed('columnCells', true);

    columnCells.exit()
        .remove();

    var columnCell = columnCells.selectAll('.columnCell')
        .data(splitToCells, gup.keyFun);

    columnCell.enter()
        .append('g')
        .classed('columnCell', true);

    columnCell.exit().remove();

    columnCell
        .each(function(d, i) {
            var spec = d.calcdata.cells.font;
            var col = d.column.specIndex;
            var font = {
                size: gridPick(spec.size, col, i),
                color: gridPick(spec.color, col, i),
                family: gridPick(spec.family, col, i)
            };
            Drawing.font(d3.select(this), font);

            d.rowNumber = d.key;
            d.align = gridPick(d.calcdata.cells.align, col, i);
            d.valign = gridPick(d.calcdata.cells.valign, col, i);
            d.cellBorderWidth = gridPick(d.calcdata.cells.line.width, col, i)
            d.font = font;
        });

    var cellRect = columnCell.selectAll('.cellRect')
        .data(gup.repeat, gup.keyFun);

    cellRect.enter()
        .append('rect')
        .classed('cellRect', true);

    cellRect
        .attr('width', function(d) {return d.column.columnWidth;})
        .attr('stroke-width', function(d) {return d.cellBorderWidth;})
        .attr('stroke', function(d) {
            return c.clipView ?
                ({header: 'blue', cells1: 'red', cells2: 'green'})[d.column.key] :
                gridPick(d.calcdata.cells.line.color, d.column.specIndex, d.rowNumber);
        })
        .attr('fill', function(d) {
            return gridPick(d.calcdata.cells.fill.color, d.column.specIndex, d.rowNumber);
        });

    var cellTextHolder = columnCell.selectAll('.cellTextHolder')
        .data(gup.repeat, gup.keyFun);

    cellTextHolder.enter()
        .append('g')
        .classed('cellTextHolder', true);

    var cellText = cellTextHolder.selectAll('.cellText')
        .data(gup.repeat, gup.keyFun);

    cellText.enter()
        .append('text')
        .classed('cellText', true);

    cellText
        .call(renderCellText, tableControlView, allColumnBlock, columnCell, gd);
}

function renderCellText(cellText, tableControlView, allColumnBlock, columnCell, gd) {
    cellText
        .text(function(d) {
            var col = d.column.specIndex;
            var row = d.rowNumber;
            var userSuppliedContent = d.value;
            var latex = latexEh(userSuppliedContent);
            var userBrokenText = (typeof userSuppliedContent !== 'string') || userSuppliedContent.match(/<br>/i);
            var prefix = latex ? '' : gridPick(d.calcdata.cells.prefix, col, row) || '';
            var suffix = latex ? '' : gridPick(d.calcdata.cells.suffix, col, row) || '';
            var format = latex ? null : gridPick(d.calcdata.cells.format, col, row) || null;
            var prefixSuffixedText = prefix + (format ? d3.format(format)(d.value) : d.value) + suffix;
            d.latex = latex;
            d.wrappingNeeded = !userBrokenText && !d.wrapped && !latex;
            var textToRender;
            if(d.wrappingNeeded) {
                var hrefPreservedText = c.wrapSplitCharacter === ' ' ? prefixSuffixedText.replace(/<a href=/ig, '<a_href=') : prefixSuffixedText;
                var fragments = hrefPreservedText.split(c.wrapSplitCharacter);
                var hrefRestoredFragments = c.wrapSplitCharacter === ' ' ? fragments.map(function(frag) {return frag.replace(/<a_href=/ig, '<a href=')}) : fragments;
                d.fragments = hrefRestoredFragments.map(function (f) {return {text: f, width: null};});
                d.fragments.push({fragment: c.wrapSpacer, width: null});
                textToRender = hrefRestoredFragments.join(c.lineBreaker) + c.lineBreaker + c.wrapSpacer;
            } else {
                delete d.fragments;
                textToRender = d.value;
            }
            return textToRender;
        })
        .each(function(d) {

            var element = this;
            var selection = d3.select(element);

            // finalize what's in the DOM
            Drawing.font(selection, d.font);
            setCellHeightAndPositionY(columnCell);

            var renderCallback = d.wrappingNeeded ? wrapTextMaker : updateYPositionMaker;
            svgUtil.convertToTspans(selection, gd, renderCallback(allColumnBlock, element, tableControlView, d));
        });
}

function latexEh(content) {
    return typeof content === 'string' && content[0] === c.latexMark && content[content.length - 1] === c.latexMark;
}

function columnMoved(gd, calcdata, i, indices) {
    var o = calcdata[i][0].gdColumnsOriginalOrder;
    calcdata[i][0].gdColumns.sort(function (a, b) {
        return indices[o.indexOf(a)] - indices[o.indexOf(b)];
    });

    calcdata[i][0].columnorder = indices;

    gd.emit('plotly_restyle');
}

function gridPick(spec, col, row) {
    if(Array.isArray(spec)) {
        var column = spec[Math.min(col, spec.length - 1)];
        if(Array.isArray(column)) {
            return column[Math.min(row, column.length - 1)];
        } else {
            return column;
        }
    } else {
        return spec;
    }
}

function easeColumn(selection, d, y) {
    selection
        .transition()
        .ease(c.releaseTransitionEase, 1, .75)
        .duration(c.releaseTransitionDuration)
        .attr('transform', 'translate(' + d.x + ' ' + y + ')');
}

function cellsBlock(d) {return d.type === 'cells';}
function headerBlock(d) {return d.type === 'header';}

/**
 * Revolver panel and cell contents layouting
 */

function splitToPanels(d) {
    var prevPages = [0, 0];
    var headerPanel = extendFlat({}, d, {
        key: 'header',
        type: 'header',
        page: 0,
        prevPages: prevPages,
        currentRepaint: [null, null],
        dragHandle: true,
        values: d.calcdata.headerCells.values[d.specIndex],
        rowBlocks: d.calcdata.headerRowBlocks,
        calcdata: extendFlat({}, d.calcdata, {cells: d.calcdata.headerCells})
    });
    var revolverPanel1 = extendFlat({}, d, {
        key: 'cells1',
        type: 'cells',
        page: 0,
        prevPages: prevPages,
        currentRepaint: [null, null],
        dragHandle: false,
        values: d.calcdata.cells.values[d.specIndex],
        rowBlocks: d.calcdata.rowBlocks
    });
    var revolverPanel2 = extendFlat({}, d, {
        key: 'cells2',
        type: 'cells',
        page: 0,
        prevPages: prevPages,
        currentRepaint: [null, null],
        dragHandle: false,
        values: d.calcdata.cells.values[d.specIndex],
        rowBlocks: d.calcdata.rowBlocks
    });
    // order due to SVG using painter's algo:
    return [revolverPanel1, revolverPanel2, headerPanel];
}

function splitToCells(d) {
    var fromTo = rowFromTo(d);
    return d.values.slice(fromTo[0], fromTo[1]).map(function(v, i) {
        return {
            key: fromTo[0] + i,
            column: d,
            calcdata: d.calcdata,
            page: d.page,
            rowBlocks: d.rowBlocks,
            value: v
        };
    });
}

function rowFromTo(d) {
    var rowBlock = d.rowBlocks[d.page];
    // fixme rowBlock truthiness check is due to ugly hack of placing 2nd panel as d.page = -1
    var rowFrom = rowBlock ? rowBlock.rows[0].rowIndex : 0;
    var rowTo = rowBlock ? rowFrom + rowBlock.rows.length : 0;
    return [rowFrom, rowTo];
}

function overlap(a, b) {
    return a[0] < b[1] && a[1] > b[0];
}

function headerHeight(d) {
    var headerBlocks = d.rowBlocks[0].auxiliaryBlocks;
    return headerBlocks.reduce(function (p, n) {return p + rowsHeight(n, Infinity)}, 0);
}

function updateBlockYPosition(gd, cellsColumnBlock, tableControlView) {

    var d = cellsColumnBlock[0][0].__data__;
    var blocks = d.rowBlocks;
    var calcdata = d.calcdata;

    var bottom = firstRowAnchor(blocks, blocks.length);
    var scrollHeight = d.calcdata.groupHeight - headerHeight(d);
    var scrollY = calcdata.scrollY = Math.max(0, Math.min(bottom - scrollHeight, calcdata.scrollY));

    var pages = [];
    for(var p = 0; p < blocks.length; p++) {
        var pTop = firstRowAnchor(blocks, p);
        var pBottom = pTop + rowsHeight(blocks[p], Infinity);
        if(overlap([scrollY, scrollY + scrollHeight], [pTop, pBottom])) {
            pages.push(p);
        }
    }
    if(pages.length === 1) {
        if(pages[0] === blocks.length - 1) {
            pages.unshift(pages[0] - 1);
        } else {
            pages.push(pages[0] + 1);
        }
    }

    // make phased out page jump by 2 while leaving stationary page intact
    if(pages[0] % 2) {
        pages.reverse();
    }

    cellsColumnBlock
        .each(function (d, i) {
            // these values will also be needed when a block is translated again due to growing cell height
            d.page = pages[i];
            d.scrollY = scrollY;
        });

    cellsColumnBlock
        .attr('transform', function (d) {
            var yTranslate = firstRowAnchor(d.rowBlocks, d.page) - d.scrollY;
            return 'translate(0 ' + yTranslate + ')';
        });

    // conditionally rerendering panel 0 and 1
    if(gd) {
        conditionalPanelRerender(gd, tableControlView, cellsColumnBlock, pages, d.prevPages, d, 0);
        conditionalPanelRerender(gd, tableControlView, cellsColumnBlock, pages, d.prevPages, d, 1);
        renderScrollbarKit(tableControlView);
    }
}

function makeDragRow(gd, tableControlView, optionalMultiplier, optionalPosition) {
    return function dragRow () {
        var d = tableControlView.node().__data__;
        var multiplier = optionalMultiplier || d.scrollbarState.dragMultiplier;
        d.scrollY = optionalPosition === void(0) ? d.scrollY + multiplier * d3.event.dy : optionalPosition;
        var cellsColumnBlock = tableControlView.selectAll('.yColumn').selectAll('.columnBlock').filter(cellsBlock);
        updateBlockYPosition(gd, cellsColumnBlock, tableControlView);
    }
}

function conditionalPanelRerender(gd, tableControlView, cellsColumnBlock, pages, prevPages, d, revolverIndex) {
    var shouldComponentUpdate = pages[revolverIndex] !== prevPages[revolverIndex];
    if(shouldComponentUpdate) {
        //window.clearTimeout(d.currentRepaint[revolverIndex]);
        //d.currentRepaint[revolverIndex] = window.setTimeout(function () {
            // setTimeout might lag rendering but yields a smoother scroll, because fast scrolling makes
            // some repaints invisible ie. wasteful (DOM work blocks the main thread)
            var toRerender = cellsColumnBlock.filter(function (d, i) {return i === revolverIndex && pages[i] !== prevPages[i];});
            renderColumnBlocks(gd, tableControlView, toRerender, toRerender);
            prevPages[revolverIndex] = pages[revolverIndex];
        //});
    }
}

function wrapTextMaker(columnBlock, element, tableControlView) {
    return function wrapText() {
        var cellTextHolder = d3.select(element.parentNode);
        cellTextHolder
            .each(function(d) {
                var fragments = d.fragments;
                cellTextHolder.selectAll('tspan.line').each(function(dd, i) {
                    fragments[i].width = this.getComputedTextLength();
                });
                // last element is only for measuring the separator character, so it's ignored:
                var separatorLength = fragments[fragments.length - 1].width;
                var rest = fragments.slice(0, -1);
                var currentRow = [];
                var currentAddition, currentAdditionLength;
                var currentRowLength = 0;
                var rowLengthLimit = d.column.columnWidth - 2 * c.cellPad;
                d.value = "";
                while(rest.length) {
                    currentAddition = rest.shift();
                    currentAdditionLength = currentAddition.width + separatorLength;
                    if(currentRowLength + currentAdditionLength > rowLengthLimit) {
                        d.value += currentRow.join(c.wrapSpacer) + c.lineBreaker;
                        currentRow = [];
                        currentRowLength = 0;
                    }
                    currentRow.push(currentAddition.text);
                    currentRowLength += currentAdditionLength;
                }
                if(currentRowLength) {
                    d.value += currentRow.join(c.wrapSpacer);
                }
                d.wrapped = true;
            });

        // the pre-wrapped text was rendered only for the text measurements
        cellTextHolder.selectAll('tspan.line').remove();

        // resupply text, now wrapped
        renderCellText(cellTextHolder.select('.cellText'), tableControlView, columnBlock, d3.select(element.parentNode.parentNode));
    };
}

function updateYPositionMaker(columnBlock, element, tableControlView, d) {
    return function updateYPosition() {
        var cellTextHolder = d3.select(element.parentNode);
        var l = getBlock(d);
        var rowIndex = d.key - l.firstRowIndex;
        var box = element.parentNode.getBoundingClientRect();

        var renderedHeight = box.height;

        var requiredHeight = renderedHeight + 2 * c.cellPad;
        var finalHeight = Math.max(requiredHeight, l.rows[rowIndex].rowHeight);
        var increase = finalHeight - l.rows[rowIndex].rowHeight;

        if(increase) {
            // current row height increased
            l.rows[d.key - l.firstRowIndex].rowHeight = finalHeight;

            columnBlock
                .selectAll('.columnCell')
                .call(setCellHeightAndPositionY);

            updateBlockYPosition(null, columnBlock.filter(cellsBlock), 0);

            // if d.column.type === 'header', then the scrollbar has to be pushed downward to the scrollable area
            // if d.column.type === 'cells', it can still be relevant if total scrolling content height is less than the
            //                               scrollable window, as increases to row heights may need scrollbar updates
            renderScrollbarKit(tableControlView);
        }

        cellTextHolder
            .attr('transform', function () {
                var element = this;
                var columnCellElement = element.parentNode;
                var box = columnCellElement.getBoundingClientRect();
                var rectBox = d3.select(element.parentNode).select('.cellRect').node().getBoundingClientRect();
                var currentTransform = element.transform.baseVal.consolidate();
                var yPosition = rectBox.top - box.top + (currentTransform ? currentTransform.matrix.f : c.cellPad);
                return 'translate(' + c.cellPad + ' ' + yPosition + ')';
            });
    };
}

function setCellHeightAndPositionY(columnCell) {
    columnCell
        .attr('transform', function(d) {
            var l = getBlock(d);
            var rowAnchor = rowsHeight(l, d.key);
            var rowOffset = firstRowAnchor(d.rowBlocks, l.key) + rowAnchor - firstRowAnchor(d.rowBlocks, d.page);
            var headerHeight = d.rowBlocks[0].auxiliaryBlocks.reduce(function(p, n) {return p + rowsHeight(n, Infinity)}, 0);
            var yOffset = rowOffset + headerHeight;
            return 'translate(0 ' + yOffset + ')';
        })
        .select('.cellRect')
        .attr('height', function(d) {return getRow(getBlock(d), d.key).rowHeight;});
}

function firstRowAnchor(rowBlocks, page) {
    var total = 0;
    for(var i = 0; i <= page - 1; i++) {
        total += rowsHeight(rowBlocks[i], Infinity);
    }
    return total;
}

function firstRowAnchor2(rowBlocks, page) {
    var total = 0;
    for(var i = 0; i < page - 1; i++) {
        total += rowsHeight(rowBlocks[i], Infinity);
    }
    return total;
}

function rowsHeight(rowBlock, key) {
    var total = 0;
    for(var i = 0; i < rowBlock.rows.length && rowBlock.rows[i].rowIndex < key; i++) {
        total += rowBlock.rows[i].rowHeight;
    }
    return total;
}

function getBlock(d) {return d.rowBlocks[d.page];}
function getRow(l, i) {return l.rows[i - l.firstRowIndex];}
