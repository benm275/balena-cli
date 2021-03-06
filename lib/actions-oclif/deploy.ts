/**
 * @license
 * Copyright 2016-2020 Balena Ltd.
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
import Command from '../command';
import { ExpectedError } from '../errors';
import { getBalenaSdk, getChalk } from '../utils/lazy';
import { dockerignoreHelp, registrySecretsHelp } from '../utils/messages';
import * as compose from '../utils/compose';
import type { ComposeCliFlags, ComposeOpts } from '../utils/compose-types';
import type { DockerCliFlags } from '../utils/docker';
import { composeCliFlags } from '../utils/compose_ts';
import { dockerCliFlags } from '../utils/docker';
import type { Application, ApplicationType, DeviceType } from 'balena-sdk';

interface ApplicationWithArch extends Application {
	arch: string;
}

interface FlagsDef extends ComposeCliFlags, DockerCliFlags {
	source?: string;
	build: boolean;
	nologupload: boolean;
	help: void;
}

interface ArgsDef {
	appName: string;
	image?: string;
}

export default class DeployCmd extends Command {
	public static description = `\
Deploy a single image or a multicontainer project to a balena application.

Usage: \`deploy <appName> ([image] | --build [--source build-dir])\`

Use this command to deploy an image or a complete multicontainer project to an
application, optionally building it first. The source images are searched for
(and optionally built) using the docker daemon in your development machine or
balena device. (See also the \`balena push\` command for the option of building
the image in the balenaCloud build servers.)

Unless an image is specified, this command will look into the current directory
(or the one specified by --source) for a docker-compose.yml file.  If one is
found, this command will deploy each service defined in the compose file,
building it first if an image for it doesn't exist. If a compose file isn't
found, the command will look for a Dockerfile[.template] file (or alternative
Dockerfile specified with the \`-f\` option), and if yet that isn't found, it
will try to generate one.

To deploy to an app on which you're a collaborator, use
\`balena deploy <appOwnerUsername>/<appName>\`.

${registrySecretsHelp}

${dockerignoreHelp}
`;

	public static examples = [
		'$ balena deploy myApp',
		'$ balena deploy myApp --build --source myBuildDir/',
		'$ balena deploy myApp myApp/myImage',
	];

	public static args = [
		{
			name: 'appName',
			description: 'the name of the application to deploy to',
			required: true,
		},
		{
			name: 'image',
			description: 'the image to deploy',
		},
	];

	public static usage = 'deploy <appName> [image]';

	public static flags: flags.Input<FlagsDef> = {
		source: flags.string({
			description:
				'specify an alternate source directory; default is the working directory',
			char: 's',
		}),
		build: flags.boolean({
			description: 'force a rebuild before deploy',
			char: 'b',
		}),
		nologupload: flags.boolean({
			description:
				"don't upload build logs to the dashboard with image (if building)",
		}),
		...composeCliFlags,
		...dockerCliFlags,
		// NOTE: Not supporting -h for help, because of clash with -h in DockerCliFlags
		// Revisit this in future release.
		help: flags.help({}),
	};

	public static authenticated = true;

	public static primary = true;

	public async run() {
		const { args: params, flags: options } = this.parse<FlagsDef, ArgsDef>(
			DeployCmd,
		);

		// compositions with many services trigger misleading warnings
		// @ts-ignore editing property that isn't typed but does exist
		(await import('events')).defaultMaxListeners = 1000;

		const logger = await Command.getLogger();
		logger.logDebug('Parsing input...');

		const { appName, image } = params;

		if (image != null && options.build) {
			throw new ExpectedError(
				'Build option is not applicable when specifying an image',
			);
		}

		const sdk = getBalenaSdk();
		const { getRegistrySecrets, validateProjectDirectory } = await import(
			'../utils/compose_ts'
		);

		if (image) {
			options['registry-secrets'] = await getRegistrySecrets(
				sdk,
				options['registry-secrets'],
			);
		} else {
			const {
				dockerfilePath,
				registrySecrets,
			} = await validateProjectDirectory(sdk, {
				dockerfilePath: options.dockerfile,
				noParentCheck: options['noparent-check'] || false,
				projectPath: options.source || '.',
				registrySecretsPath: options['registry-secrets'],
			});
			options.dockerfile = dockerfilePath;
			options['registry-secrets'] = registrySecrets;
		}

		const helpers = await import('../utils/helpers');
		const app = await helpers.getAppWithArch(appName);

		const dockerUtils = await import('../utils/docker');
		const [docker, buildOpts, composeOpts] = await Promise.all([
			dockerUtils.getDocker(options),
			dockerUtils.generateBuildOpts(options),
			compose.generateOpts(options),
		]);

		await this.deployProject(docker, logger, composeOpts, {
			app,
			appName, // may be prefixed by 'owner/', unlike app.app_name
			image,
			shouldPerformBuild: !!options.build,
			shouldUploadLogs: !options.nologupload,
			buildEmulated: !!options.emulated,
			buildOpts,
		});
	}

	async deployProject(
		docker: import('docker-toolbelt'),
		logger: import('../utils/logger'),
		composeOpts: ComposeOpts,
		opts: {
			app: ApplicationWithArch; // the application instance to deploy to
			appName: string;
			image?: string;
			dockerfilePath?: string; // alternative Dockerfile
			shouldPerformBuild: boolean;
			shouldUploadLogs: boolean;
			buildEmulated: boolean;
			buildOpts: any; // arguments to forward to docker build command
		},
	) {
		const Bluebird = await import('bluebird');
		const _ = await import('lodash');
		const doodles = await import('resin-doodles');
		const sdk = getBalenaSdk();
		const { deployProject: $deployProject, loadProject } = await import(
			'../utils/compose_ts'
		);

		const appType = (opts.app?.application_type as ApplicationType[])?.[0];

		return loadProject(logger, composeOpts, opts.image)
			.then(function (project) {
				if (
					project.descriptors.length > 1 &&
					!appType?.supports_multicontainer
				) {
					throw new ExpectedError(
						'Target application does not support multiple containers. Aborting!',
					);
				}

				// find which services use images that already exist locally
				return (
					Bluebird.map(project.descriptors, function (d: any) {
						// unconditionally build (or pull) if explicitly requested
						if (opts.shouldPerformBuild) {
							return d;
						}
						return docker
							.getImage(
								(typeof d.image === 'string' ? d.image : d.image.tag) || '',
							)
							.inspect()
							.then(() => {
								return d.serviceName;
							})
							.catch(() => {
								// Ignore
							});
					})
						.filter((d) => !!d)
						.then(function (servicesToSkip: any[]) {
							// multibuild takes in a composition and always attempts to
							// build or pull all services. we workaround that here by
							// passing a modified composition.
							const compositionToBuild = _.cloneDeep(project.composition);
							compositionToBuild.services = _.omit(
								compositionToBuild.services,
								servicesToSkip,
							);
							if (_.size(compositionToBuild.services) === 0) {
								logger.logInfo(
									'Everything is up to date (use --build to force a rebuild)',
								);
								return {};
							}
							return compose
								.buildProject(
									docker,
									logger,
									project.path,
									project.name,
									compositionToBuild,
									opts.app.arch,
									(opts.app?.is_for__device_type as DeviceType[])?.[0].slug,
									opts.buildEmulated,
									opts.buildOpts,
									composeOpts.inlineLogs,
									composeOpts.convertEol,
									composeOpts.dockerfilePath,
									composeOpts.nogitignore,
									composeOpts.multiDockerignore,
								)
								.then((builtImages) => _.keyBy(builtImages, 'serviceName'));
						})
						.then((builtImages: any) =>
							project.descriptors.map(
								(d) =>
									builtImages[d.serviceName] ?? {
										serviceName: d.serviceName,
										name: typeof d.image === 'string' ? d.image : d.image.tag,
										logs: 'Build skipped; image for service already exists.',
										props: {},
									},
							),
						)
						// @ts-ignore slightly different return types of partial vs non-partial release
						.then(function (images) {
							if (appType?.is_legacy) {
								const { deployLegacy } = require('../utils/deploy-legacy');

								const msg = getChalk().yellow(
									'Target application requires legacy deploy method.',
								);
								logger.logWarn(msg);

								return Promise.all([
									sdk.auth.getToken(),
									sdk.auth.whoami(),
									sdk.settings.get('balenaUrl'),
									{
										// opts.appName may be prefixed by 'owner/', unlike opts.app.app_name
										appName: opts.appName,
										imageName: images[0].name,
										buildLogs: images[0].logs,
										shouldUploadLogs: opts.shouldUploadLogs,
									},
								])
									.then(([token, username, url, options]) => {
										return deployLegacy(
											docker,
											logger,
											token,
											username,
											url,
											options,
										);
									})
									.then((releaseId) =>
										sdk.models.release.get(releaseId, { $select: ['commit'] }),
									);
							}
							return Promise.all([
								sdk.auth.getUserId(),
								sdk.auth.getToken(),
								sdk.settings.get('apiUrl'),
							]).then(([userId, auth, apiEndpoint]) =>
								$deployProject(
									docker,
									logger,
									project.composition,
									images,
									opts.app.id,
									userId,
									`Bearer ${auth}`,
									apiEndpoint,
									!opts.shouldUploadLogs,
								),
							);
						})
				);
			})
			.then(function (release: any) {
				logger.outputDeferredMessages();
				logger.logSuccess('Deploy succeeded!');
				logger.logSuccess(`Release: ${release.commit}`);
				console.log();
				console.log(doodles.getDoodle()); // Show charlie
				console.log();
			})
			.catch((err) => {
				logger.logError('Deploy failed');
				throw err;
			});
	}
}
