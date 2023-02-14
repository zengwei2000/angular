import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs-7';;
import { delay } from 'rxjs-7/operators';

const ALTER_EGOS = ['Eric'];

@Injectable({ providedIn: 'root' })
export class HeroesService {
  isAlterEgoTaken(alterEgo: string): Observable<boolean> {
    const isTaken = ALTER_EGOS.includes(alterEgo);

    return of(isTaken).pipe(delay(400));
  }
}
