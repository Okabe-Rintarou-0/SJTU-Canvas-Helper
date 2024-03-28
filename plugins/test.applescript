on run {input, output}
	tell application "Microsoft PowerPoint" -- work on version 15.15 or newer
		launch
		set t to input as POSIX file as string 
		if t ends with ".ppt" or t ends with ".pptx" then
			set pdfPath to output as POSIX file as string
			open t
			save active presentation in pdfPath as save as PDF -- save in same folder
		end if
	end tell
	tell application "Microsoft PowerPoint" -- work on version 15.15 or newer
		quit
	end tell
end run