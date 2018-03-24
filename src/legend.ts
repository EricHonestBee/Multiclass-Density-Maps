import * as d3 from 'd3';
import DerivedBuffer from './derived-buffer';
import * as Parser from './parser';
import Color from './color';
import Interpreter from './interp';
import * as Scale from './scale';
import Composer from './composer';
import vegaEmbed from 'vega-embed';

function translate(x:number, y:number) {
    return `translate(${x},${y})`;
}

let counter = 0;
// see degree at http://angrytools.com/gradient/
function linearGradient(defs:any, interpolator:Scale.ScaleTrait,
    db:DerivedBuffer, degree:number = 0):string {

    let x1 = 0.5 - Math.cos(degree) / 2;
    let x2 = 0.5 + Math.cos(degree) / 2;
    let y1 = 0.5 + Math.sin(degree) / 2;
    let y2 = 0.5 - Math.sin(degree) / 2;

    let id = `gradient_${counter++}`;

    let lg = defs.append('linearGradient')
        .attr('id', id)
        .attr('x1', x1)
        .attr('x2', x2)
        .attr('y1', y1)
        .attr('y2', y2)

    lg.append('stop')
        .attr('offset', 0)
        .style('stop-color', db.colorScale.map(interpolator.domain[0]).css());

    lg.append('stop')
        .attr('offset', 1)
        .style('stop-color', db.colorScale.map(interpolator.domain[1]).css());

    return id;
}

function equiDepthColorMap(defs:any, interpolator:Scale.ScaleTrait, db:DerivedBuffer):string {
    let id = `gradient_${counter++}`;
    let scale = interpolator as Scale.EquiDepthScale;

    let lg = defs.append('linearGradient')
        .attr('id', id)
        .attr('x1', 0)
        .attr('x2', 1)
        .attr('y1', 0)
        .attr('y2', 0)

    let n = scale.level;
    scale.getBounds();

    // bounds do not include the last value
    scale.bounds.concat([scale.bounds[n - 2] + 1]).forEach((value, i) => {
        let color = db.colorScale.map(value - 1);
        if(isNaN(color.r)) color = Color.Transparent;

        lg.append('stop')
            .attr('offset', i / n)
            .style('stop-color', color.css());

        lg.append('stop')
            .attr('offset', (i + 1) / n)
            .style('stop-color', color.css());
    });

    return id;
}

function colorCategories(g:d3.Selection<d3.BaseType, {}, HTMLElement, any>,
    derivedBuffers:DerivedBuffer[],
    spec:Parser.LegendSpec, labels:string[], title:string = "category") {

    let n = derivedBuffers.length;
    let rowHeight = spec.rowHeight;
    let colorMapWidth = spec.colorMapWidth;
    let labelWidth = spec.labelWidth;
    let gutter = spec.gutter;
    let verticalGutter = 2;

    g
        .append('text')
        .text(title)
        // .attr('dy', '0.5em')

    let categories = g.selectAll('g')
        .data(derivedBuffers)

    let categoryEnter = categories
        .enter()
        .append('g')
        .attr('transform', (d, i) => translate(0, (rowHeight + verticalGutter) * (i + 1)))

    categoryEnter
        .append('circle')
        .attr('r', 5)
        .attr('fill', d => d.color!.css())
        .attr('transform', translate(5, 0))

    categoryEnter
        .append('text')
        .text((d, i) => labels[i])
        .attr('transform', translate(10 + gutter, 0))
        .attr('dy', '0.4em')
        .style('font-size', spec.tickFontSize)
        .style('font-weight', 'normal')
        .attr('text-anchor', 'start')
}

function colorRamps(
    g:d3.Selection<d3.BaseType, {}, HTMLElement, any>,
    defs:d3.Selection<d3.BaseType, {}, HTMLElement, any>,
    derivedBuffers:DerivedBuffer[],
    interp:Interpreter, spec:Parser.LegendSpec, title:string = "value") {

    let n = derivedBuffers.length;
    let rowHeight = spec.rowHeight;
    let colorMapWidth = spec.colorMapWidth;
    let labelWidth = spec.labelWidth;
    let gutter = spec.gutter;
    let verticalGutter = 2;

    g.append('text')
        .text(title)
        .attr('dy', '0.5em')

    let gradientFunc:(defs:any, interpolator:Scale.ScaleTrait, db:DerivedBuffer) => string;

    // domain numbers will be shown
    let tickValues:number[] = [];

    // markers (vertical bars) will be shown
    let markerValues:number[] = [];

    let colormapScale = (v:number, i:number) => interp.scale.map(v) * colorMapWidth;

    // scales that show continuous color maps
    if(!interp.rescale || ["linear", "pow", "sqrt", "cbrt", "log"].indexOf(interp.rescale!.type) >= 0)
    {
        gradientFunc = linearGradient;
        let n = spec.markers;

        tickValues = [derivedBuffers[0].colorScale.interpolator.domain[0],
                    derivedBuffers[0].colorScale.interpolator.domain[1]];

        markerValues = d3.range(n).map(i => tickValues[0] + (tickValues[1] - tickValues[0]) * (i + 1) / (n + 1));
    }
    else if(interp.rescale!.type === "equidepth") { // discrete such as equidepth
        gradientFunc = equiDepthColorMap;

        tickValues = [derivedBuffers[0].colorScale.interpolator.domain[0]]
            .concat((interp.scale as Scale.EquiDepthScale).bounds);

        colormapScale = (v, i) => colorMapWidth / (tickValues.length - 1) * i;
        markerValues = [];
    }

    let ids = derivedBuffers.map(db => {
        return gradientFunc(defs, interp.scale, db);
    })

    let values = g.selectAll('g')
        .data(derivedBuffers)

    let valueEnter = values
        .enter()
        .append('g')
        .attr('transform', (d, i) => translate(0, (rowHeight + verticalGutter) * (i + 1)))

    // colormaps
    valueEnter
        .append('rect')
        .attr('height', rowHeight)
        .attr('width', colorMapWidth)
        .attr('transform', translate(0, 0))
        .attr('stroke', '#ddd')
        .style('fill', (d, i) => `url(#${ids[i]})`)

    let tickG = g
        .append('g')
        .attr('class', 'ticks')
        .attr('transform', translate(0, (rowHeight + verticalGutter) * (derivedBuffers.length + 1)))

    let ticks = tickG
        .selectAll('text.tick')
        .data(tickValues)

    let step = 1;
    if(spec.numTicks) {
        step = Math.floor(tickValues.length / spec.numTicks!);
    }

    // ticks (0, .., 1.7K)
    ticks.enter()
        .append('text')
        .attr('class', 'tick')
        .attr('text-anchor', (d, i) => {
            if(i === 0) return 'start';
            else if(i === tickValues.length - 1) return 'end';
            return 'middle';
        })
        .attr('transform', (d, i) => translate(colormapScale(d, i), 0))
        .style('display', (d, i) => {
            if(i % step === 0) return 'inline';
            return 'none';
        })
        .attr('dy', '1em')
        .style('font-size', spec.tickFontSize)
        .style('font-weight', 'normal')
        .text(d => d3.format(spec.format)(d))

    valueEnter
        .selectAll('line')
        .data(markerValues)
        .enter()
        .append('line')
        .attr('x1', 0)
        .attr('x2', 0)
        .attr('y1', 0)
        .attr('y2', rowHeight)
        .style('stroke', '#ddd')
        .style('stroke-width', 1)
        .style('shape-rendering', 'crispEdges')
        .attr('transform', (d, i) => translate(colormapScale(d, i), 0))

}

function colorMixMap(g:d3.Selection<d3.BaseType, {}, HTMLElement, any>,
    derivedBuffers:DerivedBuffer[],
    interp:Interpreter,
    spec:Parser.LegendSpec,
    title:string = "mix"
) {
    let n = derivedBuffers.length;
    let rowHeight = spec.rowHeight;
    let colorMapWidth = spec.colorMapWidth;
    let labelWidth = spec.labelWidth;
    let gutter = spec.gutter;
    let verticalGutter = 2;

    let size = spec.mixMapSize;

    g.append('text')
        .text(title)
        .attr('dy', '1em')


    let fo = g.append('foreignObject')
        .attr('width', size)
        .attr('height', size)
        .attr('x', 0)
        .attr('y', 0)

    /*
        Translating the <g> elements doesn't work with <foreignObject> in Webkit browsers.
        Regardless of translation, <foreignObject> is rendered as it is abolutely positioned.
        A workaround is to use the (top, left) css properties.
    */

    let canvas:HTMLCanvasElement = fo
        .append('xhtml:body')
        .attr('width', size)
        .attr('height', size)
        .style('position', 'relative')
        .style('top', '150px')
        .style('margin', 0)
        .append('canvas')
        .attr('width', size)
        .attr('height', size)
        .node() as HTMLCanvasElement

    let context = canvas.getContext('2d') as CanvasRenderingContext2D;
    let imageData = context.getImageData(0, 0, size, size);
    let data = imageData.data;

    for(let i = 0; i < data.length; i+=4) {
        data[i + 0] = Math.random() * 255;
        data[i + 1] = Math.random() * 255;
        data[i + 2] = Math.random() * 255;
        data[i + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
}


function mixLegend(id:string, interp:Interpreter) {
    let derivedBuffers:DerivedBuffer[] = interp.derivedBuffers;
    let spec = interp.legend as Parser.LegendSpec;

    let svg = d3.select('#' + id)
        .style('font-family', spec.fontFamily)
        .style('font-size', spec.fontSize)

    let defs = svg.append('defs');
    let padding = spec.padding;

    let g = svg.append('g').attr('transform', translate(padding, padding));
    let categoryG = g.append('g')
    let rampG = g.append('g');
    let n = derivedBuffers.length;
    let rowHeight = spec.rowHeight;
    let colorMapWidth = spec.colorMapWidth;
    let labelWidth = spec.labelWidth;
    let gutter = spec.gutter;
    let verticalGutter = 2;

    svg
        .attr('width', colorMapWidth + padding * 2)
        .attr('height', (rowHeight + verticalGutter) * (n + 1) * 3 + rowHeight + padding * 2)

    let labels = interp.labels == undefined ? interp.bufferNames : interp.labels;
    colorCategories(categoryG, derivedBuffers, spec, labels);

    rampG.attr('transform', translate(0, (rowHeight + verticalGutter) * (n + 1) + padding))
    colorRamps(rampG, defs, derivedBuffers, interp, spec);

    // interp.compose.mix == max or mean or blend
    // interp.compose.mixing == multiplicative or additive

    // checks whether a mix map is shown
    if(["max", "mean", "blend"].indexOf(interp.compose.mix) >= 0) {
        let mixG = g.append('g')

        colorMixMap(mixG, derivedBuffers, interp, spec);
        // mixG.attr('transform', translate(0,
        //     (rowHeight + verticalGutter) * (2 * n + 3) + padding * 2
        // ))
    }
}

function multiplicativeCircles(id:string, interp:Interpreter) {
    let derivedBuffers:DerivedBuffer[] = interp.derivedBuffers;
    let spec = interp.legend as Parser.LegendSpec;

    let size = spec.size;
    let svg = d3.select('#' + id)
        .style('font-family', spec.fontFamily)
        .style('font-size', spec.fontSize)
        .attr('width', size)
        .attr('height', size)

    let defs = svg.append('defs');
    let g = svg.append('g').attr('transform', translate(0, 0));

    let center = size / 2;
    let r = size / 6;
    let theta = Math.PI * 2 / derivedBuffers.length;
    let ids = derivedBuffers.map((d, i) => {
        return linearGradient(defs, interp.scale, d, -theta * i - Math.PI / 2);
    })

    g.selectAll('circle')
        .data(derivedBuffers)
        .enter()
        .append('circle')
        .attr('r', r)
        .attr('fill', d => d.color!.css())
        .attr('cx', (d, i) => center + r * Math.sin(theta * i) / 2)
        .attr('cy', (d, i) => center - r * Math.cos(theta * i) / 2)
        .style('fill', (d, i) => `url(#${ids[i]})`)
        .style('mix-blend-mode', 'multiply');

    g.selectAll('text')
        .data(derivedBuffers)
        .enter()
        .append('text')
        .text(d => d.originalDataBuffer.name)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.5em')
        .attr('transform', (d, i) => translate(
            center + r * Math.sin(theta * i) * 2,
            center - r * Math.cos(theta * i) * 2
        ));


        // .attr('cx', (d, i) => )
        // .attr('cy', (d, i) => )
        // .style('opacity', 0.9)
        // .style('mix-blend-mode', 'multiply');

}

function bars(id:string, interp:Interpreter) {
    let derivedBuffers:DerivedBuffer[] = interp.derivedBuffers;
    let n = derivedBuffers.length;
    let spec = interp.legend as Parser.LegendSpec;

    let svg = d3.select('#' + id)
        .style('font-family', spec.fontFamily)
        .style('font-size', spec.fontSize)

    let sum = new Array(n).fill(0);

    for(let tile of interp.tiles) {
        tile.dataValues.forEach((value, i) => {
            sum[i] += value;
        })
    }

    let mean = sum.map(s => s / n);
    let domain = interp.scale.domain as [number, number];

    let data = derivedBuffers.map((buffer, i) => {
        return {
            category: buffer.originalDataBuffer.name,
            value: (domain[1] - domain[0]) * (i + 1) / n + domain[0]
        };
    });

    let glyphSpec = interp.compose.glyphSpec!;

    let barSpec:any = {
        $schema: "https://vega.github.io/schema/vega-lite/v2.0.json",
        data: {
            values: data
        },
        mark: {
            type: "bar"
        },
        encoding: {
            x: {
                field: "category",
                type: "ordinal",
                axis: {
                    orient: "top",
                    title: "value",
                    domain: false,
                    ticks: false,
                    labels: false
                }
            },
            color: {
                field: "category",
                type: "ordinal",
                scale: {
                  domain: data.map(d => d.category),
                  range: data.map((d, i) => derivedBuffers[i].color!.css())
                },
                legend: {
                    orient: "top"
                }
            },
            y: {
                field: "value",
                type: "quantitative",
                scale: {
                    type: interp.d3scale,
                    base: interp.d3base,
                    domain: domain,
                    range: [glyphSpec.height, 0]
                },
                // legend: false,
                axis: {
                    orient: "right",
                    title: false
                }
            }
        },
        config: {
            group: {
                strokeWidth: 0
            }
        },
        width: glyphSpec.width,
        height: glyphSpec.height
    };

    let wrapper = document.createElement('div') as HTMLElement;
    return vegaEmbed(wrapper as HTMLBaseElement, barSpec, {
        actions: false,
        renderer: 'svg'
    }).then(() => {
        let result = wrapper!.getElementsByTagName('svg')[0];
        let svgNode = <SVGSVGElement>svg.node();

        svgNode.innerHTML = result.innerHTML;
        let rect = svgNode.getBoundingClientRect();
        svg.attr("width", <any>result.getAttribute("width"))
            .attr("height", <any>result.getAttribute("height"));
    });
}

function punchcard(id:string, interp:Interpreter) {
    let derivedBuffers:DerivedBuffer[] = interp.derivedBuffers;
    let n = derivedBuffers.length;
    let spec = interp.legend as Parser.LegendSpec;
    let glyphSpec = interp.compose.glyphSpec!;

    let svg = d3.select('#' + id)
        .style('font-family', spec.fontFamily)
        .style('font-size', spec.fontSize)

    let sum = new Array(n).fill(0);

    for(let tile of interp.tiles) {
        tile.dataValues.forEach((value, i) => {
            sum[i] += value;
        })
    }

    let mean = sum.map(s => s / n);

    let cols = Math.ceil(Math.sqrt(n));

    let punchcardSpec:any = {
        $schema: "https://vega.github.io/schema/vega-lite/v2.0.json",
        data: {
            values: []
        },
        layer: [
            {
                mark: "circle",
                encoding: {
                    size: {
                        field: "value",
                        type: "quantitative",
                        scale: {
                            type: interp.d3scale,
                            base: interp.d3base,
                            domain: interp.scale.domain as [number, number],
                            range: [0, Math.min(glyphSpec.width, glyphSpec.height) * glyphSpec.factor]
                        },
                        legend: {
                            orient: "left"
                        }
                    },
                    color: {
                        field: "category",
                        type: "ordinal",
                        scale: {
                            domain: derivedBuffers.map(b => b.originalDataBuffer.name),
                            range: derivedBuffers.map(b => (b.color || Color.Blue).css())
                        },
                        legend: {
                            orient: "left"
                        }
                    }
                }
            },
            {
                mark: {
                    type: "text",
                    baseline: "middle"
                },
                encoding: {
                    text: {field: "category"}
                }
            }
        ],
        encoding: {
            x: {field: "col", type: "ordinal", axis: false, legend:false},
            y: {field: "row", type: "ordinal", axis: false, legend:false},
        },
        config: {
            group: {
                strokeWidth: 0
            },
            mark: {
                opacity: 1
            }
        },
        width: spec.width,
        height: spec.height,
        padding: 5
    };

    let wrapper = document.createElement('div') as HTMLElement;
    return vegaEmbed(wrapper as HTMLBaseElement, punchcardSpec, {
        actions: false,
        renderer: 'svg'
    }).then(() => {
        let result = wrapper!.getElementsByTagName('svg')[0];
        let svgNode = <SVGSVGElement>svg.node();

        svgNode.innerHTML = result.innerHTML;
        let rect = svgNode.getBoundingClientRect();
        svg.attr("width", <any>result.getAttribute("width"))
            .attr("height", <any>result.getAttribute("height"));
    });
}

export default function LegendBuilder(id:string, interp:Interpreter) {
    if(interp.legend === false) return;

    if(interp.composer === Composer.multiplicativeMix) {
        multiplicativeCircles(id, interp);
    }
    else if(interp.compose.mix === "glyph") {
        if(interp.compose.glyphSpec!.template === "bars") {
            bars(id, interp);
        }
        else if(interp.compose.glyphSpec!.template === "punchcard") {
            punchcard(id, interp);
        }
    }
    else {
        mixLegend(id, interp);
    }
}
