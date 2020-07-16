/**
 * @license
 * Copyright 2019 Balena Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { flags } from '@oclif/command';

import type { IBooleanFlag } from '@oclif/parser/lib/flags';
import { stripIndent } from './lazy';

export const application = flags.string({
	char: 'a',
	description: 'application name',
});
// TODO: Consider remove second alias 'app' when we can, to simplify.
export const app = flags.string({
	description: "same as '--application'",
});

export const device = flags.string({
	char: 'd',
	description: 'device UUID',
});

export const help: IBooleanFlag<void> = flags.help({ char: 'h' });

export const quiet: IBooleanFlag<boolean> = flags.boolean({
	char: 'q',
	description: 'suppress warning messages',
	default: false,
});

export const release = flags.string({
	char: 'r',
	description: 'release id',
});

export const service = flags.string({
	char: 's',
	description: 'service name',
});

export const verbose: IBooleanFlag<boolean> = flags.boolean({
	char: 'v',
	description: 'produce verbose output',
});

export const yes: IBooleanFlag<boolean> = flags.boolean({
	char: 'y',
	description: 'answer "yes" to all questions (non interactive use)',
});

export const force: IBooleanFlag<boolean> = flags.boolean({
	char: 'f',
	description: 'force action if the update lock is set',
});

export const drive = flags.string({
	char: 'd',
	description: stripIndent`
		the drive to write the image to, eg. \`/dev/sdb\` or \`/dev/mmcblk0\`.
		Careful with this as you can erase your hard drive.
		Check \`balena util available-drives\` for available options.
	`,
});
