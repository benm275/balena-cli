_ = require('lodash')
_.str = require('underscore.string')
async = require('async')
npm = require('npm')
visuals = require('resin-cli-visuals')

exports.list =
	signature: 'plugins'
	description: 'list all plugins'
	help: '''
		Use this command to list all the installed resin plugins.

		Examples:
			$ resin plugins
	'''
	permission: 'user'
	action: (params, options, done) ->
		async.waterfall([

			(callback) ->
				npm.load
					depth: 0
					parseable: true
				, callback

			(data, callback) ->
				npm.commands.list([], true, callback)

			(data, lite, callback) ->
				resinModules = _.filter _.values(data.dependencies), (resinModule) ->

					# TODO: Reuse plugin glob from app.coffee
					return _.str.startsWith(resinModule.name, 'resin-plugin')

				if _.isEmpty(resinModules)
					console.log('You don\'t have any plugins yet')
					return done()

				console.log visuals.widgets.table.horizontal resinModules, [
					'name'
					'version'
					'description'
					'license'
				]

				return callback()

		], done)

exports.install =
	signature: 'plugin install <name>'
	description: 'install a plugin'
	help: '''
		Use this command to install a resin plugin

		Examples:
			$ resin plugin install hello
	'''
	permission: 'user'
	action: (params, options, done) ->
		async.waterfall [

			(callback) ->
				npm.load({}, callback)

			(data, callback) ->

				# TODO: This action outputs installation information that cannot
				# be quieted neither with --quiet nor --silent:
				# https://github.com/npm/npm/issues/2040
				npm.commands.install([
					"resin-plugin-#{params.name}"
				], callback)

		], (error) ->
			return done() if not error?

			if error.code is 'E404'
				error.message = "Plugin not found: #{params.name}"

			return done(error) if error?
