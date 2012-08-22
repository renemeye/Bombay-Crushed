/** @file
 * The logic required to build a table of initiatives, e.g. as used in the overview page.
 */

var lf = require('./lfcli.js');
var issue = require('./issue.js');

/**
 * get event text for event code
 *
 * @param event event object
 */

var getTextForEvent = function(event) {
	switch(event.event) {
		case "initiative_created_in_existing_issue":
			return "Neue Initiative";
			break;
		case "initiative_created_in_new_issue":
			return "Neues Thema";
			break;
		case "suggestion_created":
			return "Neue Anregung";
			break;
		case "new_draft_created":
			return "Neuer Entwurf";
			break;
		case "initiative_revoked":
			return "Initative zurückgezogen";
			break;
		case "issue_state_changed":
			switch(event.state) {
				case "finished_with_winner":
					return "Abstimmung beendet";
					break;
				case "verification":
					return "Thema eingefroren";
					break;
				case "voting":
					return "Abstimmung begonnen";
					break;
				case "discussion":
					return "Thema zugelassen";
					break;
				case "admission":
					return "Neues Thema";
					break;
				case "finished_without_winner":
					return "Thema Abgebrochen";
					break;
			}
			break;
	}
};

/**
 * Retrieve all initiatives as required to build the table on the overview page.
 * The resulting data is stored in `state.context.initable`.
 * Parameters of the current HTTP-Query used:
 *  * page: Pagination of the table
 *
 * @param state State of the current HTTP-Request
 * @param render The callback function to notify once data collection is finished
 */
var inis = function(state, render) {
	var events = [];
	var issues = [];
	var areas = [];
	var units = [];
	var inis = [];
	var policies = [];

	var activepage;
	state.context.initable = {};
	if(state.url.query.page !== undefined) {
		activepage = state.url.query.page - 1;
		state.context.initable.activepage = state.url.query.page;
	}
	else {
		activepage = 0;
		state.context.initable.activepage = 1;
	}

	// check if timeline page
	if(state.url.query.timeline !== undefined)
		state.context.initable.isTimeline = state.url.query.timeline;

	/**
	 * Internal data collection callback.
	 *
	 * Called every time a data collection function returns. If all data has been collected
	 * finalizes data processing and calls external callback.
	 */
	var finish = function() {
		builtInis = [];
		if(events.length === issues.length
			&& events.length === areas.length
			&& events.length === units.length
			&& events.length === inis.length
			&& events.length === policies.length) {

			for(var i = 0; i < events.length; i++) {
				var ini = { lastaction: {} };
				date = new Date(events[i].occurrence);
				ini.lastaction.date = date.getDate() + '.' + ( date.getMonth() + 1 ) + '.' + date.getFullYear();
				ini.lastaction.time = date.getHours() + ':' + date.getMinutes();
				ini.lastaction.action = getTextForEvent(events[i]);

				ini.status = issue.getIssueStateText(events[i].state);

				for(var j = 0; j < inis.length; j++) {
					if(inis[j].issue_id === events[i].issue_id) {
						ini.id = inis[j].id;
						ini.title = inis[j].name;
						ini.supporter = inis[j].satisfied_supporter_count;
						ini.potsupporter = inis[j].supporter_count - inis[j].satisfied_supporter_count;
					}
				}
				var quorum_num, quorum_den;
				for(var a = 0; a < issues.length; a++) {
					if(issues[a].id === events[i].issue_id) {
						for(var b = 0; b < areas.length; b++) {
							if(areas[b].id === issues[a].area_id) {
								ini.area = areas[b].name;
								ini.area_id = areas[b].id;
								// TODO number for uninterested is sometimes negative?
								ini.uninterested = ( areas[b].member_weight - ini.supporter ) - ini.potsupporter;
								if(ini.uninterested < 0) {
									ini.uninterested = 0;
								}
								for(var c = 0; c < units.length; c++) {
									if(units[c].id === areas[b].unit_id) {
										ini.unit = units[c].name;
									}
								}
							}
						}
						for(var k = 0; k < policies.length; k++) {
							if(issues[a].policy_id === policies[k].id) {
								quorum_num = policies[k].issue_quorum_num;
								quorum_den = policies[k].issue_quorum_den;
							}
						}
					}
				}
				var total = ini.supporter + ini.potsupporter + ini.uninterested;
				ini.support = Math.floor(( ini.supporter / total ) * 100);
				ini.potential = Math.floor(( ini.potsupporter / total ) * 100);
				ini.uninvolved = Math.floor(( ini.uninterested / total ) * 100);
				ini.quorum = Math.floor(100 * quorum_num / quorum_den);

				builtInis.push(ini);
			}

			state.context.inis = builtInis;
			render();			
		}
	}

	// get last events
 	lf.query('/event', {}, state, function(res) {
		// calculate number of pages
		var foundissues = [];
		var foundissue = false;
		for(var i = 0; i < res.result.length; i++) {
			foundissue = false;
			for(var j = 0; j < foundissues.length; j++) {
				if(foundissues[j] == res.result[i].issue_id) {
					foundissue = true;
				}
			}
			if(foundissue == false) {
				foundissues.push(res.result[i].issue_id);
			}
		}

		state.context.initable.pages = Math.ceil(foundissues.length / 5);
		var end = ( activepage * 5 ) + 5;
		var found = false;
		var foundpage = false;
		for(var i = activepage * 5; i < res.result.length && i < end; i++) {
			// start with first found issue on the page
			if(foundpage == false && res.result[i].issue_id != foundissues[activepage * 5]) {
				end = end + 1;
				continue;
			}
			else {
				foundpage = true;
			}

			found = false;
			// check if event has issue that was already registered
			for(var l = 0; l < events.length; l++) {
				if(events[l].issue_id == res.result[i].issue_id) {
					found = true;
					break;
				}
			}
			if(found == false) {
				events.push(res.result[i]);
			}
			else {
				end = end + 1;
				continue;
			}
			// get issue for event
			// only embed unit, area und policy for the issue
			// doing this in the event query itself would cause the API to embed ALL data
			lf.query('/issue', {'issue_id': res.result[i].issue_id, 'include_areas': 1, 'include_units': 1, 'include_policies': 1}, state, function(issue_res) {
				issues.push(issue_res.result[0]);
				// get area for issue
				area = issue_res.areas[issue_res.result[0].area_id];
				areas.push(area);
				// get unit for area
				units.push(issue_res.units[area.unit_id]);
				// get policy for issue
				policies.push(issue_res.policies[issue_res.result[0].policy_id]);
				// get inis for issue
				lf.query('/initiative', {'issue_id': issue_res.result[0].id}, state, function(ini_res) {
					// get the leading ini
					var found = false;
					for(var j = 0; j < ini_res.result.length; j++) {
						if(ini_res.result[j].rank === 1) {
							inis.push(ini_res.result[j]);	
							found = true;						
						}
					}
					if(found === false) {
						var leadingIni = ini_res.result[0];
						for(var j = 0; j < ini_res.result.length; j++) {
							if(leadingIni.satisfied_supporter_count < ini_res.result[j].satisfied_supporter_count) {
								leadingIni = ini_res.result[j];
							}
						}
						inis.push(leadingIni);
					}
					finish();
				});
				finish();
			});
		}
		finish();
	});
};

/*
 * exported functions of this module
 */

module.exports.lastInis = inis;

module.exports.mySupportedInis = function(state, render) {

	var inisDone = false;
	var inis = [];
	var events = [];

	var finish = function() {
		if(inisDone && inis.length == events.length) {

			state.context.inis = [];

			for(var i = 0; i < inis.length; i++) {

				builtIni = {};

				// get event
				for(var a = 0; a < events.length; a++) {
					if(events[a].initiative_id == inis[i].id) {
						builtIni.lastaction = {};
						date = new Date(events[a].occurrence);
						builtIni.lastaction.date = date.getDate() + '.' + ( date.getMonth() + 1 ) + '.' + date.getFullYear();
						builtIni.lastaction.time = date.getHours() + ':' + date.getMinutes();
						builtIni.lastaction.action = getTextForEvent(events[a]);
					}
				}

				builtIni.id = inis[i].id;
				builtIni.title = inis[i].name;
				builtIni.supporter = inis[i].satisfied_supporter_count;
				builtIni.potsupporter = inis[i].supporter_count - inis[i].satisfied_supporter_count;
				builtIni.status = issue.getIssueStateText(ini.issue.state);

				// continue filling attributes..

				state.context.inis.push(builtIni);
			}

			render();
		}
	}

	// get all my supported initiatives, this is currently not working in the API..
	lf.query('/initiative', {'supporter_member_id': state.user_id(), 'include_issues': 1, 'include_areas': 1, 'include_units': 1, 'include_policies': 1}, state, function(ini_res) {
		for(var i = 0; i < ini_res.result.length; i++) {
			// get last event per initiative
			lf.query('/event', {'initiative_id': ini_res.result[i].id}, state, function(event_res) {
				// sort events by date
				Array.prototype.sort.call(event_res.result, function(a,b) {
    					if (a.created > b.created)
        					return -1;
    					else if (a.created < b.created)
        					return 1;
    					else 
        					return 0;
				});
				events.push(event_res.result[0]);
				finish();
			});
			ini = ini_res.result[i];
			ini.issue = ini_res.issues[ini.issue_id];
			ini.area = ini_res.areas[ini.issue.area_id];
			ini.unit = ini_res.units[ini.area.unit_id];
			ini.policy = ini_res.policies[ini.issue.policy_id];

			inis.push(ini_res.result[i]);
		}
		inisDone = true;
		finish()
	});

}
