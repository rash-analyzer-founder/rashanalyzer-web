 function switchPage(pageName) {
            // Hide all pages
            document.getElementById('intro-page').style.display = 'none';
            document.getElementById('tools-page').style.display = 'none';
            document.getElementById('projects-page').style.display = 'none';
            document.getElementById('hq-page').style.display = 'none';
            document.getElementById('explore-page').style.display = 'none';
            document.getElementById('chat-page').style.display='none';
            document.getElementById('work-page').style.display='none';
            document.getElementById('learn-page').style.display='none';
            document.getElementById('chat-page').style.display='none';
            document.getElementById('updates-page').style.display='none';
            document.getElementById('account-page').style.display='none';
            
             
            
            // Show selected page
            document.getElementById(pageName + '-page').style.display = 'block';
            
            // Update active tab
            const tabs = document.querySelectorAll('.nav-tab');
            tabs.forEach(tab => tab.classList.remove('active'));
            event.target.classList.add('active');
        }