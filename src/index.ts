import CanvasRenderer from './canvas-renderer';
import Mask from './mask';
import Image from './image';
import Tile, {TileAggregation} from './tile';
import DataBuffer from './data-buffer';
import Color from './color';
import * as util from './util';
import * as Tiling from './tiling';

/// <reference path="multivariate-normal.d.ts" />
import MN from "multivariate-normal";

export function weavingRandomMasks(m: number, size: number, width: number, height: number) : Mask[]
{
    let masks:Mask[] = Array<Mask>(m);
    size = Math.floor(size);

    for (let i = 0; i < m; i++) {
        masks[i] = new Mask(width, height, 0);
    }
    for (let row = 0; row < height; row += size) {
        let row_max = Math.min(row+size, height);
        for (let col = 0; col < width; col += size) {
            let col_max = Math.min(col+size, width);
            let selected = Math.floor(Math.random() * m);
            let mask = masks[selected];
            mask.path.rect(row, col, size, size);
            for (let r = row; r < row_max; r++) {
                for (let c = col; c < col_max; c++) {
                    mask.mask[r][c] = 1;
                }
            }
        }
    }
    return masks;
}

export function renderTileWeaving(image:Image, tile:Tile, buffers:DataBuffer[], bufferValues:number[]) : void
{
  for (let i = 0; i < buffers.length; i++) {
    let databuffer = buffers[i];
    let color:Color = databuffer.color.whiten(bufferValues[i]);
    image.setMask(databuffer.mask);
    image.fillByTile(color, tile);
  }
}

export class TestMain {
  constructor() {

  }

  randomPointsWithClass(n:number, mean:any, cov:any): any[] {
    let dist = MN(mean, cov);
    return new Array(n).fill(0).map(() => {
      let point = dist.sample();
      return point;
    });
  }

  bin(points:[number, number][], binSize:number, bounds:[[number, number], [number, number]]):number[][] {
    let count = util.create2D(binSize, binSize, 0);

    points.forEach(([x, y]) => {
      let xb = Math.floor((x - bounds[0][0]) / (bounds[0][1] - bounds[0][0]) * binSize);
      let yb = Math.floor((y - bounds[1][0]) / (bounds[1][1] - bounds[1][0]) * binSize);

      if(xb >= binSize) xb = binSize - 1;
      if(yb >= binSize) yb = binSize - 1;
      if(xb < 0) xb = 0;
      if(yb < 0) yb = 0;

      count[yb][xb]++;
    })

    return count;
  }

  normalize(binned:number[][][]) {
    let arrayMax = (arr:number[]) => Math.max.apply({}, arr);
    let maxValue = arrayMax(binned.map(rows => arrayMax(rows.map(row => arrayMax(row)))))
    return binned.map(rows => rows.map(row => row.map(value => value / maxValue)));
  }

  composeMax(buffers:DataBuffer[], bufferValues:number[]):Color {
    let best = bufferValues[0];
    let bestIndex = 0;

    bufferValues.forEach((bufferValue, i) => {
      if(bufferValue > best) {
        best = bufferValue;
        bestIndex = i;
      }
    });

    return buffers[bestIndex].color.whiten(best);
  }

  composeMix(buffers:DataBuffer[], bufferValues:number[]):Color {
    let sum = 0;
    let ret = new Color(0, 0, 0, 1);

    bufferValues.forEach((bufferValue, i) => {
      sum += bufferValue;
      ret = ret.add(buffers[i].color.whiten(bufferValue));
    });

    if(sum > 0)
      ret = ret.dissolve(1 / buffers.length); // TODO: is this correct?

    return ret;
  }

  main() {
    let nClass = 3;
    let width = 256, height = 256;
    let pointSets:any[] = [
      this.randomPointsWithClass(3000, [2, 3], [[1, 0.3], [0.3, 1]]),
      this.randomPointsWithClass(3000, [-1, -3.5], [[1, -0.1], [-0.1, 1]]),
      this.randomPointsWithClass(3000, [1, -2], [[1, 0.6], [0.6, 1]])
    ];

    // binning on the client side since we do not have a server
    let binned = pointSets.map(points => this.bin(points, width, [[-7, 7], [-7, 7]]))

    // normlize bins
    binned = this.normalize(binned);

    // computeDerivedBuffers()
    let dataBuffers:DataBuffer[] = binned.map((binnedPoints, i) => {
      return new DataBuffer(`class ${i}`, width, height, binnedPoints);
    });

    let colors:Color[] = [
      new Color(31 / 255, 120 / 255, 180 / 255, 1), // blue
      new Color(255 / 255, 127 / 255, 0 / 255, 1), // orange
      new Color(51 / 255, 160 / 255, 44 / 255, 1) // green
    ];

    // assignProperties()
    dataBuffers.forEach((dataBuffer, i) => {
      dataBuffer.color = colors[i];
    });

    let pixelTiling = new Tiling.PixelTiling(width, height);
    let outputImage1 = new Image(width, height);

    for(let tile of pixelTiling) { // hope we can use ES2016
      let bufferValues:number[] = dataBuffers.map(
        (buffer):number => tile.aggregate(buffer, TileAggregation.Sum)
      )

      let color = this.composeMax(dataBuffers, bufferValues);
      outputImage1.fillByTile(color, tile);
    }

    CanvasRenderer.render(outputImage1, 'canvas1');

    let rectangularTiling = new Tiling.RectangularTiling(width, height, width / 64, height / 64);
    let outputImage2 = new Image(width, height);

    for(let tile of rectangularTiling) { // hope we can use ES2016
      let bufferValues:number[] = dataBuffers.map(
        (buffer):number => tile.aggregate(buffer, TileAggregation.Sum)
      )

      // TODO: we need to RE-normalize buffer values.

      let color = this.composeMax(dataBuffers, bufferValues);
      outputImage2.fillByTile(color, tile);
    }

    CanvasRenderer.render(outputImage2, 'canvas2');

    let outputImage3 = new Image(width, height);

    for(let tile of rectangularTiling) { // hope we can use ES2016
      let bufferValues:number[] = dataBuffers.map(
        (buffer):number => tile.aggregate(buffer, TileAggregation.Sum)
      )

      // TODO: we need to RE-normalize buffer values.

      let color = this.composeMix(dataBuffers, bufferValues);
      outputImage3.fillByTile(color, tile);
    }

    CanvasRenderer.render(outputImage3, 'canvas3');

    let bigRectangularTiling = new Tiling.RectangularTiling(width, height, 16, 16);
    let outputImage4 = new Image(width, height);
    let masks = weavingRandomMasks(3, 4, width, height);

    // assignProperties()
    dataBuffers.forEach((dataBuffer, i) => {
      dataBuffer.mask = masks[i];
    });

    for(let tile of bigRectangularTiling) { // hope we can use ES2016
      let bufferValues:number[] = dataBuffers.map(
        (buffer):number => tile.aggregate(buffer, TileAggregation.Mean)
      )

      // TODO: we need to RE-normalize buffer values.

      renderTileWeaving(outputImage4, tile, dataBuffers, bufferValues);
    }

    CanvasRenderer.render(outputImage4, 'canvas4');
  }
}

export * from './vega-extractor';
