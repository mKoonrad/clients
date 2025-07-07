import { combineLatest, map, Observable, of } from "rxjs";

import { BasePolicy } from "../organizations/policies";

export class PolicyListService {
  private policies$: Observable<BasePolicy[]> = of([]);

  addPolicies(policies: Observable<BasePolicy[]>) {
    this.policies$ = combineLatest([this.policies$, policies]).pipe(
      map(([policies, newPolicies]) => policies.concat(newPolicies)),
    );
  }

  getPolicies(): Observable<BasePolicy[]> {
    return this.policies$;
  }
}
