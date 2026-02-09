import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'evalToBar',
  standalone: true
})
export class EvalBarPipe implements PipeTransform {
  transform(value: string | number | null | undefined): number {
    if (value === null || value === undefined) {
      return 50;
    }
    if (typeof value === 'string' && value.startsWith('M')) {
      return 100;
    }
    if (typeof value === 'string' && value.startsWith('-M')) {
      return 0;
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      return 50;
    }
    const clamped = Math.max(-5, Math.min(5, num));
    return 50 + clamped * 10;
  }
}
