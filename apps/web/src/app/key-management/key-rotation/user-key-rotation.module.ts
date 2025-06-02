import { NgModule } from "@angular/core";

import { TestableUserKeyRotationService } from "./testable-user-key-rotation.service";
import { UserKeyRotationApiService } from "./user-key-rotation-api.service";

@NgModule({
  providers: [TestableUserKeyRotationService, UserKeyRotationApiService],
})
export class UserKeyRotationModule {}
