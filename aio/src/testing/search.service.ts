import { Subject } from 'rxjs-7';;
import { SearchResults } from 'app/search/interfaces';

export class MockSearchService {
  searchResults = new Subject<SearchResults>();
  initWorker = jasmine.createSpy('initWorker');
  loadIndex = jasmine.createSpy('loadIndex');
  search = jasmine.createSpy('search');
}
